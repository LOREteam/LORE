import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { parseAbi, toFunctionSelector } from "viem";

const EIP_170_RUNTIME_LIMIT = 24_576;
const EIP_3860_INITCODE_LIMIT = 49_152;
const V10_CONSTRUCTOR_ARGUMENT_BYTES = 3 * 32;
const V9_PATH = "contracts/LineaOreV9.sol";
const V10_PATH = "contracts/LineaOreV10.sol";
const V9_NAME = "LineaOreV9";
const V10_NAME = "LineaOreV10";
const V10_COMPILER_CONFIG_PATH = "contracts/LineaOreV10.compiler-config.json";
const V10_COMPILATION_MANIFEST_PATH = "contracts/LineaOreV10.compilation.json";
const v9Source = fs.readFileSync(V9_PATH, "utf8").replace(/\r\n?/g, "\n");
const v10Source = fs.readFileSync(V10_PATH, "utf8").replace(/\r\n?/g, "\n");
const frontendConstantsSource = fs.readFileSync("app/lib/constants.ts", "utf8").replace(/\r\n?/g, "\n");
const resolveAbiSource = fs.readFileSync("config/abi.ts", "utf8").replace(/\r\n?/g, "\n");
const indexerSource = fs.readFileSync("scripts/indexer.ts", "utf8").replace(/\r\n?/g, "\n");
const liveStateSharedSource = fs.readFileSync("app/api/live-state/shared.ts", "utf8").replace(/\r\n?/g, "\n");
const standardBetPathSource = fs.readFileSync("app/hooks/useMiningStandardBetPath.ts", "utf8").replace(/\r\n?/g, "\n");
const gasBenchmarkSource = fs.readFileSync("scripts/benchmark-v10-linea-gas.ts", "utf8").replace(/\r\n?/g, "\n");
const deployedVerifierSource = fs.readFileSync("scripts/verify-v10-deployed.ts", "utf8").replace(/\r\n?/g, "\n");
const ciWorkflowSource = fs.readFileSync(".github/workflows/ci.yml", "utf8").replace(/\r\n?/g, "\n");
const v10DesignSource = fs.readFileSync("docs/v10-contract-design.md", "utf8").replace(/\r\n?/g, "\n");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const v10CompilerConfig = JSON.parse(fs.readFileSync(V10_COMPILER_CONFIG_PATH, "utf8"));
const v10CompilationManifest = JSON.parse(fs.readFileSync(V10_COMPILATION_MANIFEST_PATH, "utf8"));
assert.deepEqual(
  {
    language: v10CompilerConfig.language,
    optimizer: v10CompilerConfig.settings?.optimizer,
    viaIR: v10CompilerConfig.settings?.viaIR,
    evmVersion: v10CompilerConfig.settings?.evmVersion,
  },
  {
    language: "Solidity",
    optimizer: { enabled: true, runs: 200 },
    viaIR: false,
    evmVersion: "osaka",
  },
  "V10 compiler config must match the canonical profile",
);
assert.match(
  v10DesignSource,
  /canonical profile is Solidity 0\.8\.36, optimizer 200, no IR, Osaka, OpenZeppelin 5\.6\.1/,
  "reviewer design must state the canonical compiler and dependency profile",
);
assert.ok(
  v10DesignSource.includes(
    `${v10CompilationManifest.bytecodeBytes.toLocaleString("en-US")} creation bytes and ` +
      `${v10CompilationManifest.runtimeBytecodeBytes.toLocaleString("en-US")} runtime bytes`,
  ),
  "reviewer design bytecode sizes must match the canonical compilation manifest",
);
assert.match(
  v10DesignSource,
  /fresh current post-resolve scan covers all seven resolved epochs, passes all 29\s+applicable exact checks[\s\S]{0,180}prior 5,000-epoch-cap run produced the\s+same call set/,
  "reviewer design must carry the latest complete deployed negative matrix",
);
assert.match(
  v10DesignSource,
  /`EpochEnded`\s+remains ABI-only compatibility surface[\s\S]{0,240}no other declared custom error without a live revert/,
  "reviewer design must explain the sole compatibility-only custom error",
);
assert.match(
  v10DesignSource,
  /Expired and funded[\s\S]{0,280}Reverts `EpochClosing`[\s\S]{0,280}accrues the resolver reward to the caller/,
  "reviewer design must expose the protected-versus-legacy funded-expiry boundary",
);
assert.match(
  v10DesignSource,
  /legacy-selector caller can resolve a funded expired epoch[\s\S]{0,360}protected selector deliberately refuses this path/,
  "reviewer design must disclose the legacy combined resolve-and-bet behavior",
);
for (const forbidden of [
  "privateKeyToAccount",
  "_PRIVATE_KEY",
  "createWalletClient",
  "deployContract",
  "sendRawTransaction",
  "sendTransaction",
  "signTransaction",
  "writeContract",
]) {
  assert.doesNotMatch(
    gasBenchmarkSource,
    new RegExp(`\\b${forbidden}\\b`),
    `read-only V10 benchmark must not reference ${forbidden}`,
  );
}
assert.match(
  gasBenchmarkSource,
  /LORE_LIVE_TEST_\$\{role\}_ADDRESS/,
  "read-only V10 benchmark must select senders from public addresses",
);
const accountReadinessType = gasBenchmarkSource.match(/type AccountReadiness = \{([\s\S]*?)\n\};/)?.[1] ?? "";
assert.match(accountReadinessType, /\brole:\s*LiveTestRole;/, "account readiness diagnostics must identify roles");
assert.match(accountReadinessType, /\bconfigured:\s*boolean;/, "account readiness diagnostics must identify missing roles");
assert.match(accountReadinessType, /\beligible:\s*boolean;/, "account readiness diagnostics must expose eligibility");
assert.doesNotMatch(
  accountReadinessType,
  /\baddress\b/,
  "account readiness diagnostics must never include public addresses",
);
assert.match(
  gasBenchmarkSource,
  /reportAccountReadiness\("token-account-not-ready", completeAccountReadiness\(accountReadiness\)\)/,
  "blocked transaction-free gas estimates must emit redacted role-level readiness",
);
assert.match(
  gasBenchmarkSource,
  /reportAccountReadiness\("no-configured-account", completeAccountReadiness\(\[\]\)\)/,
  "missing account configuration must emit the same redacted four-role readiness matrix",
);
assert.match(
  gasBenchmarkSource,
  /deploymentOnly[\s\S]*getBalance\(\{ address \}\)[\s\S]*No configured public address has native balance for deployment estimation/,
  "deployment-only estimation must not require token balance or allowance",
);
assert.match(
  gasBenchmarkSource,
  /preparedInitCode[\s\S]*assert\.equal\(preparedInitCode, canonicalInitCode[\s\S]*preparedInitCodeMatch:\s*true/,
  "deployment-only estimation must bind Linea gas evidence to the prepared canonical initcode",
);
assert.equal(
  packageJson.scripts?.["bench:contract:v10:deployment"],
  "npm run prepare:contract:v10:deployment && tsx scripts/benchmark-v10-linea-gas.ts --deployment-only",
  "deployment preflight must regenerate canonical initcode before read-only Linea estimation",
);
assert.equal(
  packageJson.scripts?.["bench:contract:v10:behavior"],
  "tsx scripts/benchmark-v10-linea-gas.ts --behavior-only",
  "state-override behavior checks must remain independently runnable without a funded account",
);
assert.match(
  ciWorkflowSource,
  /Contract invariants \(V9 and V10\)[\s\S]*npm run test:contract\n\s+npm run test:contract:v10/,
  "CI must gate both V9 compatibility and the active V10 invariants",
);
assert.match(
  ciWorkflowSource,
  /Contract compilation provenance \(V9 and V10\)[\s\S]*npm run proof:contract-compile\n\s+npm run proof:contract-compile:v10/,
  "CI must verify both canonical contract manifests",
);
assert.match(
  ciWorkflowSource,
  /\.tmp\/contract-compilation-provenance\.json[\s\S]*\.tmp\/contract-compilation-provenance-v10\.json/,
  "CI must retain both compilation provenance artifacts",
);
assert.match(
  standardBetPathSource,
  /if \(!supported\) \{\s*if \(CONTRACT_REQUIRES_EPOCH_BOUND_BETS\)/,
  "V10 frontend cutover must be able to forbid legacy epoch-unbound betting",
);
assert.ok(
  standardBetPathSource.indexOf("if (CONTRACT_REQUIRES_EPOCH_BOUND_BETS)") <
    standardBetPathSource.indexOf("using compatible legacy bet path"),
  "required epoch-bound capability must fail before the legacy bet fallback",
);
assert.match(
  deployedVerifierSource,
  /V10_EXPECTED_TOKEN_ADDRESS/,
  "fresh V10 verification must require an independently entered token address",
);
assert.match(
  deployedVerifierSource,
  /configuredTokenAddress\s*!==\s*expectedToken/,
  "fresh V10 verification must compare expected and configured token addresses",
);
assert.match(
  deployedVerifierSource,
  /function decimals\(\) view returns \(uint8\)/,
  "deployed V10 verification must read token decimals",
);
assert.match(
  deployedVerifierSource,
  /tokenDecimals\s+as\s+number\)\s*===\s*18/,
  "deployed V10 verification must reject a token that violates the app's 18-decimal boundary",
);
assert.match(
  deployedVerifierSource,
  /NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1/,
  "fresh V10 verification must require the frontend's fail-closed epoch-bound mode",
);
assert.match(
  deployedVerifierSource,
  /expectedOwner:\s*!fresh\s*\|\|\s*getAddress\(initialOwner as Address\)\s*===\s*expectedOwner/,
  "fresh V10 verification must bind the expected owner to deployment-block state",
);
assert.match(
  deployedVerifierSource,
  /expectedFeeRecipient:\s*!fresh\s*\|\|\s*getAddress\(initialFeeRecipient as Address\)\s*===\s*expectedFeeRecipient/,
  "fresh V10 verification must bind the expected fee recipient to deployment-block state",
);
assert.match(
  deployedVerifierSource,
  /deploymentBlock\.timestamp\s*===\s*\(initialEpochStartTime as bigint\)/,
  "deployment timestamp verification must not depend on the latest epoch clock",
);
assert.match(
  deployedVerifierSource,
  /freshInitialState:[\s\S]*?\(initialCurrentEpoch as bigint\)\s*===\s*1n[\s\S]*?\(initialEpochDuration as bigint\)\s*===\s*60n/,
  "fresh initial-state verification must remain valid after later epochs mutate current state",
);
assert.ok(
  (deployedVerifierSource.match(/blockNumber:\s*expectedDeployBlock!/g) ?? []).length >= 10,
  "constructor-era admin, pool, claim, and balance reads must stay pinned to the deployment block",
);
for (const forbidden of ["privateKeyToAccount", "createWalletClient", "deployContract", "sendTransaction", "signTransaction", "writeContract"]) {
  assert.doesNotMatch(
    deployedVerifierSource,
    new RegExp(`\\b${forbidden}\\b`),
    `V10 verifier and deployment artifact preparation must not reference ${forbidden}`,
  );
}
assert.match(
  deployedVerifierSource,
  /DEPLOYMENT_INITCODE_PATH\s*=\s*"\.tmp\/v10-canonical-initcode\.hex"[\s\S]*--prepare-deployment/,
  "canonical V10 initcode must be generated only as an ignored local artifact",
);
assert.match(
  deployedVerifierSource,
  /STANDARD_JSON_PATH\s*=\s*"\.tmp\/v10-canonical-standard-json-input\.json"[\s\S]*--prepare-deployment/,
  "canonical Standard JSON must be generated only as an ignored local artifact",
);
assert.ok(
  deployedVerifierSource.indexOf("fs.rmSync(deploymentInitcodeOutputPath") <
    deployedVerifierSource.indexOf("const expectedTokenRaw"),
  "a failed preparation must remove any stale deployable artifact before validating inputs",
);
assert.ok(
  deployedVerifierSource.indexOf("fs.rmSync(standardJsonOutputPath") <
    deployedVerifierSource.indexOf("const expectedTokenRaw"),
  "a failed preparation must remove any stale Standard JSON artifact before validating inputs",
);
assert.match(
  deployedVerifierSource,
  /fs\.writeFileSync\(deploymentInitcodeTempPath[\s\S]*fs\.renameSync\(deploymentInitcodeTempPath, deploymentInitcodeOutputPath\)/,
  "validated initcode must be published atomically instead of exposing a partial file",
);
assert.match(
  deployedVerifierSource,
  /buildCanonicalStandardJson[\s\S]*sourceUnitsSha256[\s\S]*Source-unit hash mismatch[\s\S]*Standard JSON creation bytecode drifted[\s\S]*Standard JSON runtime bytecode drifted/,
  "Standard JSON preparation must hash every source unit and reproduce exact canonical bytecode",
);
assert.match(
  deployedVerifierSource,
  /fs\.writeFileSync\(standardJsonTempPath[\s\S]*fs\.renameSync\(standardJsonTempPath, standardJsonOutputPath\)[\s\S]*fs\.renameSync\(deploymentInitcodeTempPath, deploymentInitcodeOutputPath\)/,
  "validated Standard JSON must be published before the initcode marker without exposing a partial deployable artifact",
);
assert.match(
  deployedVerifierSource,
  /sha256\(compiled\.creation\)[\s\S]*compilationManifest\.bytecodeSha256[\s\S]*sha256\(compiled\.runtime\)[\s\S]*compilationManifest\.runtimeBytecodeSha256/,
  "deployment artifact preparation must fail closed on compiler-manifest drift",
);
assert.match(
  deployedVerifierSource,
  /if \(prepareDeployment\)[\s\S]*EIP_3860_INITCODE_LIMIT[\s\S]*mode:\s*0o600[\s\S]*networkAccess:\s*false[\s\S]*walletAccess:\s*false[\s\S]*transactionSent:\s*false/,
  "deployment artifact preparation must remain local-only, permission-restricted, and transaction-free",
);
assert.equal(
  packageJson.scripts?.["prepare:contract:v10:deployment"],
  "npm run proof:contract-compile:v10 && tsx scripts/verify-v10-deployed.ts --prepare-deployment",
  "canonical deployment preparation must always run compilation provenance first",
);
assert.equal(
  packageJson.scripts?.["prepare:contract:v10:standard-json"],
  "npm run proof:contract-compile:v10 && tsx scripts/verify-v10-deployed.ts --prepare-standard-json",
  "canonical Standard JSON preparation must always run compilation provenance first",
);
assert.equal(
  packageJson.scripts?.["prepare:contract:v10:remix-workspace"],
  "npm run proof:contract-compile:v10 && tsx scripts/verify-v10-deployed.ts --prepare-remix-workspace",
  "canonical Remix workspace preparation must always run compilation provenance first",
);
assert.match(
  deployedVerifierSource,
  /const prepareStandardJson = PREPARE_STANDARD_JSON[\s\S]*const prepareRemixWorkspace = PREPARE_REMIX_WORKSPACE[\s\S]*Number\(fresh\) \+ Number\(prepareDeployment\) \+ Number\(prepareStandardJson\) \+ Number\(prepareRemixWorkspace\) > 1/,
  "fresh verification and every canonical artifact preparation mode must remain separate phases",
);
assert.match(
  deployedVerifierSource,
  /const PREPARE_STANDARD_JSON = process\.argv\.includes\("--prepare-standard-json"\);[\s\S]*const PREPARE_REMIX_WORKSPACE = process\.argv\.includes\("--prepare-remix-workspace"\);[\s\S]*if \(!PREPARE_STANDARD_JSON && !PREPARE_REMIX_WORKSPACE\) \{[\s\S]*loadDotenv\(\{ path: "\.env\.local"[\s\S]*loadDotenv\(\{ path: "\.env"/,
  "constructor-independent source preparation must not read deployment env files",
);
assert.match(
  deployedVerifierSource,
  /if \(prepareStandardJson\)[\s\S]*constructorBound: false[\s\S]*networkAccess: false[\s\S]*walletAccess: false[\s\S]*transactionSent: false[\s\S]*return;/,
  "source-only Standard JSON preparation must not require constructor binding or gain network/write capability",
);
assert.match(
  deployedVerifierSource,
  /function writeCanonicalRemixWorkspace[\s\S]*Unsafe source-unit path[\s\S]*Source unit escapes workspace[\s\S]*Remix workspace creation bytecode drifted[\s\S]*Remix workspace runtime bytecode drifted[\s\S]*sources: \{ \[CONTRACT_PATH\]: workspaceSources\[CONTRACT_PATH\] \}[\s\S]*Workspace import not found[\s\S]*Root-only Remix workspace creation bytecode drifted[\s\S]*Root-only Remix workspace runtime bytecode drifted/,
  "canonical Remix workspace preparation must reject path traversal and reproduce exact canonical bytecode through full-source and root-import compilation",
);
assert.match(
  deployedVerifierSource,
  /LineaOreV10 Canonical Remix Deployment[\s\S]*source-set SHA-256[\s\S]*creation SHA-256[\s\S]*runtime SHA-256[\s\S]*Constructor arguments, in order[\s\S]*proof:contract-deployed:v10:fresh[\s\S]*fs\.writeFileSync\(path\.resolve\(outputPath, "README\.md"\)/,
  "canonical Remix workspace must carry a generated identity, constructor-order, and fail-closed verification guide",
);
assert.match(
  deployedVerifierSource,
  /if \(prepareRemixWorkspace\)[\s\S]*workspaceBytecodeMatches: true[\s\S]*rootImportBytecodeMatches: workspace\.rootImportBytecodeMatches[\s\S]*deploymentGuide: `\$\{REMIX_WORKSPACE_PATH\}\/\$\{workspace\.deploymentGuide\}`[\s\S]*networkAccess: false[\s\S]*walletAccess: false[\s\S]*transactionSent: false[\s\S]*return;[\s\S]*catch \(error\)[\s\S]*fs\.rmSync\(remixWorkspaceOutputPath/,
  "failed Remix workspace preparation must remove partial output and remain transaction-free",
);
const deploymentConfigIndex = deployedVerifierSource.indexOf("const network = getConfiguredLineaNetwork();");
assert.ok(
  deploymentConfigIndex > deployedVerifierSource.indexOf("if (prepareStandardJson)") &&
    deploymentConfigIndex > deployedVerifierSource.indexOf("if (prepareRemixWorkspace)"),
  "constructor-independent source preparation must finish before deployment network/token config is read",
);

const localGateSegments = packageJson.scripts?.["gate:contract:v10:local"]
  ?.split("&&")
  .map((segment) => segment.trim());
assert.deepEqual(
  localGateSegments,
  [
    "npm run proof:contract-compile:v10",
    "npm run test:contract:v10",
    "npm run bench:contract:v10:compiler-matrix:summary",
    "npm run bench:contract:v10:diagnostics",
    "npm run proof:contract-deployed:v10:offline",
    "npm run test:contract",
    "npm run test:indexer-storage",
    "npm run test:logic",
    "npm run typecheck",
    "npx eslint app/lib/constants.ts scripts/check-solidity-compiler-advisories.mjs scripts/test-contract-v10-invariants.mjs scripts/benchmark-contract-v10.mjs scripts/benchmark-v10-linea-gas.ts scripts/plan-v10-postdeploy-canary.ts scripts/verify-v10-deployed.ts",
    "npm run build",
  ],
  "local V10 gate must remain deterministic and exclude RPC, advisory, deploy, and soak commands",
);
assert.deepEqual(
  packageJson.scripts?.["gate:contract:v10:review"]
    ?.split("&&")
    .map((segment) => segment.trim()),
  [
    "npm run proof:contract-compiler-advisories:v10",
    "npm run gate:contract:v10:local",
    "npm run bench:contract:v10:behavior",
  ],
  "review gate must add the official advisory and synthetic-caller behavior proof without requiring funded gas rows",
);
assert.deepEqual(
  packageJson.scripts?.["gate:contract:v10:predeploy"]
    ?.split("&&")
    .map((segment) => segment.trim()),
  [
    "npm run proof:contract-compiler-advisories:v10",
    "npm run gate:contract:v10:local",
    "npm run bench:contract:v10:summary",
  ],
  "predeploy gate must retain the funded read-only Linea gas benchmark",
);
assert.deepEqual(
  packageJson.scripts?.["gate:contract:v10:postdeploy:readonly"]
    ?.split("&&")
    .map((segment) => segment.trim()),
  [
    "npm run proof:contract-deployed:v10:fresh",
    "npm run proof:chain -- --strict",
  ],
  "postdeploy read-only gate must verify exact deployed bytecode before collecting chain state",
);

function readImport(importPath) {
  for (const candidate of [path.resolve(importPath), path.resolve("node_modules", importPath)]) {
    try {
      return { contents: fs.readFileSync(candidate, "utf8") };
    } catch {
      // Try the next deterministic local import root.
    }
  }
  return { error: `Import not found: ${importPath}` };
}

function compile(contractPath, contractName) {
  const source = contractPath === V9_PATH ? v9Source : v10Source;
  const input = {
    language: "Solidity",
    sources: { [contractPath]: { content: source } },
    settings: contractName === V10_NAME ? {
      ...v10CompilerConfig.settings,
      outputSelection: {
        "*": {
          "*": [
            ...v10CompilerConfig.settings.outputSelection["*"]["*"],
            "devdoc",
            "userdoc",
          ],
        },
      },
    } : {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      evmVersion: "osaka",
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "storageLayout",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.opcodes",
          ],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  assert.deepEqual(errors.map((entry) => entry.formattedMessage), [], `${contractName} must compile cleanly`);
  if (contractName === V10_NAME) {
    const warnings = (output.errors ?? []).filter((entry) => entry.severity === "warning");
    const unexpectedWarnings = warnings.filter(
      (entry) =>
        entry.sourceLocation?.file !== "@openzeppelin/contracts/utils/TransientSlot.sol" ||
        !entry.message.includes("The use of transient storage for reentrancy guards that are cleared at the end of the call is safe"),
    );
    assert.deepEqual(
      unexpectedWarnings.map((entry) => entry.formattedMessage),
      [],
      `${contractName} must compile without unexpected warnings`,
    );
  }
  const compiled = output.contracts?.[contractPath]?.[contractName];
  assert.ok(compiled, `missing compiler output for ${contractName}`);
  return compiled;
}

function extractFunctionBody(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `missing function body ${name}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function extractFunctionHeader(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `missing function body ${name}`);
  return source.slice(start, open);
}

const gasBenchmarkMainBody = extractFunctionBody(gasBenchmarkSource, "main");
const diagnosticsOnlyIndex = gasBenchmarkMainBody.indexOf('process.argv.includes("--diagnostics-only")');
const environmentLoadIndex = gasBenchmarkMainBody.indexOf('loadDotenv({ path: ".env.local"');
const behaviorOnlyIndex = gasBenchmarkMainBody.indexOf('process.argv.includes("--behavior-only")');
const fundedAccountSelectionIndex = gasBenchmarkMainBody.indexOf("const accountAddresses = configuredAccountAddresses()");
assert.notEqual(diagnosticsOnlyIndex, -1, "V10 benchmark is missing diagnostics-only mode");
assert.notEqual(environmentLoadIndex, -1, "V10 benchmark is missing runtime environment loading");
assert.notEqual(behaviorOnlyIndex, -1, "V10 benchmark is missing behavior-only mode");
assert.notEqual(fundedAccountSelectionIndex, -1, "V10 benchmark is missing funded-account selection");
assert.ok(
  diagnosticsOnlyIndex < environmentLoadIndex,
  "local V10 diagnostics must return before loading environment files",
);
assert.ok(
  behaviorOnlyIndex < fundedAccountSelectionIndex,
  "state-override behavior checks must return before funded-account selection",
);
const betDataBody = extractFunctionBody(gasBenchmarkSource, "_betData");
for (const selector of [
  "placeBet",
  "placeBatchBets",
  "placeBatchBetsSameAmount",
  "placeBatchBetsBitmap",
  "placeBatchBetsBitmapForEpoch",
]) {
  assert.match(betDataBody, new RegExp(`IGame\\.${selector}`), `behavior harness must exercise ${selector}`);
}
assert.match(
  gasBenchmarkSource,
  /betEntrypointSemantics:\s*"exact-tile-pools\/user-bets\/user-volume\/all-five-v10-selectors\/all-four-v9-selectors"/,
  "behavior report must retain exact state-semantic coverage for every bet selector",
);
for (const selector of [
  "getEpochEndTime",
  "getJackpotInfo",
  "previewRebate",
  "getRebateInfo",
  "getRebateSummary",
]) {
  assert.match(
    gasBenchmarkSource,
    new RegExp(`functionName:\\s*"${selector}"`),
    `behavior matrix must call the production ${selector} ABI directly`,
  );
}
assert.match(
  gasBenchmarkSource,
  /frontendViewCompatibility:\s*"epoch-end\/jackpot-aggregate\/rebate-preview-info-summary\/duplicate-preview\/exact-expiry"/,
  "behavior report must retain the V9/V10 frontend-view and exact-expiry matrix",
);

function canonicalAbiKey(item) {
  const inputTypes = (item.inputs ?? []).map(({ type }) => type).join(",");
  return `${item.type}:${item.name ?? "constructor"}(${inputTypes})`;
}

function canonicalAbiValue(item) {
  return JSON.stringify({
    type: item.type,
    name: item.name ?? "",
    inputs: (item.inputs ?? []).map(({ type, indexed }) => ({ type, indexed: Boolean(indexed) })),
    outputs: (item.outputs ?? []).map(({ type }) => type),
    stateMutability: item.stateMutability ?? "",
    anonymous: Boolean(item.anonymous),
  });
}

function extractParseAbiItems(source, constantName) {
  const marker = new RegExp(`(?:export\\s+)?const\\s+${constantName}\\s*=\\s*parseAbi\\(\\[`);
  const match = marker.exec(source);
  assert.ok(match, `missing ${constantName} parseAbi block`);
  const start = match.index;
  const end = source.indexOf("]);", start);
  assert.notEqual(end, -1, `unterminated ${constantName} parseAbi block`);
  return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function abiMap(abi) {
  return new Map(abi.map((item) => [canonicalAbiKey(item), canonicalAbiValue(item)]));
}

function constantExpression(source, name) {
  const match = source.match(new RegExp(`uint(?:32|256)\\s+(?:internal|public)\\s+constant\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(match, `missing constant ${name}`);
  return match[1].replace(/\s+/g, "");
}

function jsPopcount(value) {
  let remaining = value >>> 0;
  let count = 0;
  while (remaining !== 0) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

function swarPopcount(value) {
  let result = value >>> 0;
  result = (result - ((result >>> 1) & 0x55555555)) >>> 0;
  result = ((result & 0x33333333) + ((result >>> 2) & 0x33333333)) >>> 0;
  result = ((result + (result >>> 4)) & 0x0f0f0f0f) >>> 0;
  result = (result + (result >>> 8)) >>> 0;
  result = (result + (result >>> 16)) >>> 0;
  return result & 0x3f;
}

const v9 = compile(V9_PATH, V9_NAME);
const v10 = compile(V10_PATH, V10_NAME);
const v9Abi = abiMap(v9.abi);
const v10Abi = abiMap(v10.abi);
const benchmarkFrontendViewAbi = parseAbi(extractParseAbiItems(gasBenchmarkSource, "FRONTEND_VIEW_ABI"));
for (const functionItem of benchmarkFrontendViewAbi) {
  const key = canonicalAbiKey(functionItem);
  const value = canonicalAbiValue(functionItem);
  assert.equal(v9Abi.get(key), value, `benchmark frontend-view ABI drifted from V9: ${key}`);
  assert.equal(v10Abi.get(key), value, `benchmark frontend-view ABI drifted from V10: ${key}`);
}
const frontendGameAbi = parseAbi(extractParseAbiItems(frontendConstantsSource, "GAME_ABI"));
const frontendGameEventsAbi = parseAbi(extractParseAbiItems(frontendConstantsSource, "GAME_EVENTS_ABI"));
const sharedResolveAbi = parseAbi(extractParseAbiItems(resolveAbiSource, "RESOLVE_ABI"));
const indexerEventsAbi = parseAbi(extractParseAbiItems(indexerSource, "EVENTS_ABI"));
const liveStateReadAbi = parseAbi(extractParseAbiItems(liveStateSharedSource, "LIVE_STATE_ABI"));
const liveStateEventsAbi = parseAbi(extractParseAbiItems(liveStateSharedSource, "LIVE_STATE_EVENTS_ABI"));
const frontendGameAbiKeys = new Set(frontendGameAbi.map(canonicalAbiKey));
for (const functionItem of frontendGameAbi.filter((item) => item.type === "function")) {
  const key = canonicalAbiKey(functionItem);
  assert.equal(v10Abi.get(key), canonicalAbiValue(functionItem), `frontend GAME_ABI function drifted from V10: ${key}`);
}
for (const errorItem of v10.abi.filter((item) => item.type === "error")) {
  assert.ok(
    frontendGameAbiKeys.has(canonicalAbiKey(errorItem)),
    `frontend GAME_ABI is missing V10 error ${canonicalAbiKey(errorItem)}`,
  );
}
const declaredV10Errors = [...v10Source.matchAll(/^\s*error\s+([A-Za-z_]\w*)\s*\(/gm)]
  .map((match) => match[1]);
const revertedV10Errors = new Set(
  [...v10Source.matchAll(/\brevert\s+([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]),
);
assert.deepEqual(
  declaredV10Errors.filter((name) => !revertedV10Errors.has(name)),
  ["EpochEnded"],
  "V10 may retain only the V9 EpochEnded compatibility error without a live revert site",
);
assert.match(
  v9Source,
  /\brevert\s+EpochEnded\s*\(/,
  "the compatibility-only V10 EpochEnded error must remain behaviorally anchored in V9",
);
assert.ok(
  frontendGameAbiKeys.has("function:placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)"),
  "frontend GAME_ABI must expose the V10 epoch-bound bitmap entrypoint",
);
for (const [sourceName, abi] of [
  ["frontend GAME_EVENTS_ABI", frontendGameEventsAbi],
  ["shared RESOLVE_ABI", sharedResolveAbi],
  ["indexer EVENTS_ABI", indexerEventsAbi],
  ["live-state LIVE_STATE_ABI", liveStateReadAbi],
  ["live-state LIVE_STATE_EVENTS_ABI", liveStateEventsAbi],
]) {
  for (const item of abi) {
    const key = canonicalAbiKey(item);
    assert.equal(v10Abi.get(key), canonicalAbiValue(item), `${sourceName} drifted from V10: ${key}`);
  }
}
assert.deepEqual(
  liveStateEventsAbi.map((item) => item.name).sort(),
  ["BatchBetsBitmapPlaced", "BatchBetsPlaced", "BatchBetsSameAmountPlaced", "BetPlaced"],
  "live-state recovery must stay limited to bet-placement events used for tile-user reconstruction",
);
const locallyDeclaredV10EventNames = new Set(
  [...v10Source.matchAll(/^\s*event\s+([A-Za-z_]\w*)\s*\(/gm)].map((match) => match[1]),
);
const locallyDeclaredV10EventKeys = v10.abi
  .filter((item) => item.type === "event" && locallyDeclaredV10EventNames.has(item.name))
  .map(canonicalAbiKey)
  .sort();
assert.deepEqual(
  frontendGameEventsAbi.map(canonicalAbiKey).sort(),
  locallyDeclaredV10EventKeys,
  "frontend GAME_EVENTS_ABI must cover every locally declared V10 event",
);
for (const eventName of locallyDeclaredV10EventNames) {
  assert.match(v10Source, new RegExp(`\\bemit\\s+${eventName}\\s*\\(`), `${eventName} must be emitted`);
}
const indexerEventNames = indexerEventsAbi.map((item) => item.name).sort();
const indexerEventNameSet = new Set(indexerEventNames);
const frontendEventNames = frontendGameEventsAbi.map((item) => item.name).sort();
const frontendEventNameSet = new Set(frontendEventNames);
const frontendOnlyEventNames = frontendEventNames.filter((name) => !indexerEventNameSet.has(name));
const expectedFrontendOnlyEventNames = [
  "EpochDurationChangeCancelled",
  "EpochDurationChangeScheduled",
  "EpochDurationUpdated",
  "FeeRecipientChangeCancelled",
  "FeeRecipientChangeScheduled",
  "FeeRecipientUpdated",
  "RebateDustBatchSettled",
  "RewardDustBatchSettled",
].sort();
const encodedIndexerTopicEvents = [
  ...indexerSource.matchAll(/encodeEventTopics\(\{\s*abi:\s*EVENTS_ABI,\s*eventName:\s*"([^"]+)"/g),
].map((match) => match[1]).sort();
const decodedIndexerHandlerEvents = [
  ...new Set([...indexerSource.matchAll(/decoded\.eventName\s*!==\s*"([^"]+)"/g)].map((match) => match[1])),
].sort();
assert.deepEqual(
  indexerEventNames,
  [
    "BatchBetsBitmapPlaced",
    "BatchBetsPlaced",
    "BatchBetsSameAmountPlaced",
    "BetPlaced",
    "DailyJackpotAwarded",
    "EpochResolved",
    "ProtocolFeesFlushed",
    "RebateBatchClaimed",
    "RebateClaimed",
    "RebateDustSettled",
    "ResolverRewardAccrued",
    "ResolverRewardClaimed",
    "RewardBatchClaimed",
    "RewardClaimed",
    "RewardDustSettled",
    "WeeklyJackpotAwarded",
  ].sort(),
  "indexer EVENTS_ABI must retain the reviewed accounting event surface",
);
assert.deepEqual(
  encodedIndexerTopicEvents,
  indexerEventNames,
  "indexer must keep one topic signature for every EVENTS_ABI event and no topic outside EVENTS_ABI",
);
assert.deepEqual(
  decodedIndexerHandlerEvents,
  indexerEventNames,
  "indexer must keep one decode/handler guard for every EVENTS_ABI event and no handler outside EVENTS_ABI",
);
for (const topicEventName of encodedIndexerTopicEvents) {
  assert.ok(indexerEventNameSet.has(topicEventName), `indexer topic event is missing from EVENTS_ABI: ${topicEventName}`);
}
assert.ok(
  !indexerEventNames.includes("RewardDustBatchSettled") &&
    !indexerEventNames.includes("RebateDustBatchSettled"),
  "indexer intentionally stores per-epoch dust settlements instead of aggregate batch dust events",
);
assert.deepEqual(
  frontendOnlyEventNames,
  expectedFrontendOnlyEventNames,
  "frontend-only V10 events must stay limited to reviewed admin and aggregate dust notifications",
);
for (const batchDustEvent of ["RewardDustBatchSettled", "RebateDustBatchSettled"]) {
  assert.ok(frontendEventNameSet.has(batchDustEvent), `${batchDustEvent} must remain visible to frontend/event consumers`);
  assert.ok(frontendOnlyEventNames.includes(batchDustEvent), `${batchDustEvent} must remain frontend-only, not indexed as per-epoch dust`);
}
assert.match(
  extractFunctionBody(v10Source, "settleEpochsDust"),
  /_settleRewardDustIfAvailable\(rewardEpochs\[i\]\)/,
  "reward dust batch settlement must keep routing through the per-epoch indexed helper",
);
assert.match(
  extractFunctionBody(v10Source, "_settleRewardDustIfAvailable"),
  /emit\s+RewardDustSettled\s*\(\s*epoch\s*,\s*dust\s*\)/,
  "reward dust helper must emit the per-epoch event indexed from batch paths",
);
assert.match(
  extractFunctionBody(v10Source, "settleEpochsRebateDust"),
  /_settleRebateDustIfAvailable\(rebateEpochs\[i\]\)/,
  "rebate dust batch settlement must keep routing through the per-epoch indexed helper",
);
assert.match(
  extractFunctionBody(v10Source, "_settleRebateDustIfAvailable"),
  /emit\s+RebateDustSettled\s*\(\s*epoch\s*,\s*dust\s*\)/,
  "rebate dust helper must emit the per-epoch event indexed from batch paths",
);
const epochBoundBitmapSelector = toFunctionSelector("placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)")
  .slice(2)
  .toLowerCase();
assert.equal(
  v9.evm.deployedBytecode.object.toLowerCase().includes(epochBoundBitmapSelector),
  false,
  "V9 runtime must not be mistaken for the epoch-bound V10 capability",
);
assert.equal(
  v10.evm.deployedBytecode.object.toLowerCase().includes(epochBoundBitmapSelector),
  true,
  "V10 runtime must expose the selector used by frontend capability detection",
);
const frontendSelectorSignature = standardBetPathSource.match(
  /EPOCH_BOUND_BITMAP_SELECTOR\s*=\s*toFunctionSelector\(\s*"([^"]+)"/s,
)?.[1];
assert.equal(
  frontendSelectorSignature,
  "placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)",
  "frontend capability detection must use the compiled V10 selector signature",
);
assert.match(v10Source, /pragma\s+solidity\s+0\.8\.36\s*;/, "V10 must fail compilation under a drifted compiler");
assert.match(v10Source, /Ownable\(_validatedInitialOwner\(initialOwner\)\)/, "initial owner must be validated before Ownable construction");
assert.match(extractFunctionBody(v10Source, "_validatedInitialOwner"), /InvalidInitialOwner/);
assert.match(v10Source, /tokenAddress\.code\.length\s*==\s*0/, "constructor must reject token addresses without code");
assert.match(v10Source, /initialOwner\s*==\s*address\(this\)/, "constructor must reject self ownership");

const expectedTokenInteractions = new Map([
  ["claimResolverRewards", ["token.safeTransfer(msg.sender, amount)"]],
  ["claimEpochRebate", ["token.safeTransfer(msg.sender, amount)"]],
  ["claimEpochsRebate", ["token.safeTransfer(msg.sender, totalAmount)"]],
  ["settleEpochDust", ["token.safeTransfer(feeRecipient, dust)"]],
  ["settleEpochsDust", ["token.safeTransfer(feeRecipient, totalDust)"]],
  ["settleEpochRebateDust", ["token.safeTransfer(feeRecipient, dust)"]],
  ["settleEpochsRebateDust", ["token.safeTransfer(feeRecipient, totalDust)"]],
  ["placeBet", ["token.safeTransferFrom(msg.sender, address(this), amount)"]],
  ["placeBatchBets", ["token.safeTransferFrom(msg.sender, address(this), totalAmount)"]],
  ["placeBatchBetsSameAmount", ["token.safeTransferFrom(msg.sender, address(this), totalAmount)"]],
  ["placeBatchBetsBitmap", ["token.safeTransferFrom(msg.sender, address(this), totalAmount)"]],
  ["placeBatchBetsBitmapForEpoch", ["token.safeTransferFrom(msg.sender, address(this), totalAmount)"]],
  ["claimReward", ["token.safeTransfer(msg.sender, reward)"]],
  ["claimRewards", ["token.safeTransfer(msg.sender, totalReward)"]],
  ["_flushProtocolFees", [
    "token.safeTransfer(feeRecipient, ownerAmount)",
    "token.safeTransfer(BURN_ADDRESS, burnAmount)",
  ]],
]);
let checkedTokenInteractions = 0;
for (const [functionName, expectedCalls] of expectedTokenInteractions) {
  const body = extractFunctionBody(v10Source, functionName).replace(/\s+/g, " ");
  const observedCalls = body.match(/token\.safeTransfer(?:From)?\s*\([^;]+\)/g) ?? [];
  assert.equal(observedCalls.length, expectedCalls.length, `${functionName} token-call count changed`);
  for (const expectedCall of expectedCalls) {
    assert.ok(body.includes(expectedCall), `${functionName} token interaction changed: ${expectedCall}`);
  }
  checkedTokenInteractions += observedCalls.length;
}
for (const functionName of [...expectedTokenInteractions.keys()].filter((name) => !name.startsWith("_"))) {
  const declarationPattern = new RegExp(
    `function\\s+${functionName}\\s*\\([^)]*\\)\\s*[^{};]*\\bexternal\\b[^{};]*\\bnonReentrant\\b`,
  );
  assert.match(
    v10Source,
    declarationPattern,
    `${functionName} must remain an external nonReentrant token-moving entrypoint`,
  );
}
const batchFinancialExits = new Map([
  ["claimEpochsRebate", ["if (totalAmount == 0) revert NoRebateAvailable()", "token.safeTransfer(msg.sender, totalAmount)"]],
  ["settleEpochsDust", ["if (epochsSettled == 0) revert NothingToClaim()", "token.safeTransfer(feeRecipient, totalDust)"]],
  ["settleEpochsRebateDust", ["if (totalDust == 0) revert NothingToClaim()", "token.safeTransfer(feeRecipient, totalDust)"]],
  ["claimRewards", ["if (totalReward == 0) revert NothingToClaim()", "token.safeTransfer(msg.sender, totalReward)"]],
]);
for (const [functionName, [emptyGuard, aggregateTransfer]] of batchFinancialExits) {
  const body = extractFunctionBody(v10Source, functionName).replace(/\s+/g, " ");
  const loopEndIndex = body.lastIndexOf("unchecked { ++i; }");
  const guardIndex = body.indexOf(emptyGuard);
  const transferIndex = body.indexOf(aggregateTransfer);
  assert.notEqual(loopEndIndex, -1, `${functionName} calldata loop end changed`);
  assert.notEqual(guardIndex, -1, `${functionName} empty aggregate guard changed`);
  assert.notEqual(transferIndex, -1, `${functionName} aggregate transfer changed`);
  assert.ok(loopEndIndex < guardIndex, `${functionName} must finish aggregation before empty-result guard`);
  assert.ok(guardIndex < transferIndex, `${functionName} must guard the aggregate before transfer`);
}
const dustSettlementLiabilityClosures = new Map([
  ["settleEpochDust", ["_settleRewardDustIfAvailable(epoch)", "token.safeTransfer(feeRecipient, dust)"]],
  ["settleEpochRebateDust", ["_settleRebateDustIfAvailable(epoch)", "token.safeTransfer(feeRecipient, dust)"]],
]);
for (const [functionName, [liabilityClose, transfer]] of dustSettlementLiabilityClosures) {
  const body = extractFunctionBody(v10Source, functionName).replace(/\s+/g, " ");
  const closeIndex = body.indexOf(liabilityClose);
  const transferIndex = body.indexOf(transfer);
  assert.notEqual(closeIndex, -1, `${functionName} liability close helper changed`);
  assert.notEqual(transferIndex, -1, `${functionName} dust transfer changed`);
  assert.ok(closeIndex < transferIndex, `${functionName} must close accounting before external transfer`);
}
assert.match(
  extractFunctionBody(v10Source, "_settleRewardDustIfAvailable").replace(/\s+/g, " "),
  /ep\.resolutionData = resolutionData \| REWARD_DUST_SETTLED_FLAG; uint256 rewardPool = ep\.rewardPool; uint256 claimed = epochRewardClaimed\[epoch\];[\s\S]*emit RewardDustSettled\(epoch, dust\);/,
  "reward dust helper must close the epoch before computing and emitting the settlement",
);
assert.match(
  extractFunctionBody(v10Source, "_settleRebateDustIfAvailable").replace(/\s+/g, " "),
  /dust = rebatePool - claimed; epochRebateClaimed\[epoch\] = rebatePool; emit RebateDustSettled\(epoch, dust\);/,
  "rebate dust helper must close the claimable balance before emitting the settlement",
);
const allTokenInteractions = v10Source.match(/token\.safeTransfer(?:From)?\s*\([^;]+\)/g) ?? [];
assert.equal(allTokenInteractions.length, checkedTokenInteractions, "unclassified V10 token interaction");
assert.doesNotMatch(v10Source, /\.\s*(?:call|delegatecall|staticcall)\s*(?:\{|\()/, "low-level calls require explicit review");
assert.doesNotMatch(v10Source, /\bassembly\s*(?:\([^)]*\))?\s*\{/, "inline assembly requires explicit review");
assert.doesNotMatch(v10Source, /\bnew\s+[A-Za-z_]\w*\s*\(/, "runtime contract creation requires explicit review");
assert.match(v10Source, /initialFeeRecipient\s*==\s*address\(this\)/, "constructor must reject a self fee recipient");
assert.match(
  extractFunctionBody(v10Source, "_scheduleFeeRecipientChange"),
  /newRecipient\s*==\s*address\(this\)/,
  "scheduled fee recipient must reject the contract itself",
);
for (const [key, expected] of v9Abi) {
  if (key === "function:tileUserCounts(uint256,uint256)") {
    const compatiblePureGetter = JSON.parse(expected);
    compatiblePureGetter.stateMutability = "pure";
    assert.equal(v10Abi.get(key), JSON.stringify(compatiblePureGetter), `V10 must preserve the V9 ABI item ${key}`);
  } else {
    assert.equal(v10Abi.get(key), expected, `V10 must preserve the V9 ABI item ${key}`);
  }
}
const additiveV10AbiItems = [...v10Abi.keys()].filter((key) => !v9Abi.has(key)).sort();
assert.deepEqual(
  additiveV10AbiItems,
  [
    "error:EpochClockOverflow()",
    "error:ResolutionDataOverflow()",
    "error:UnexpectedEpoch()",
    "error:UserEpochVolumeOverflow()",
    "function:placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)",
  ],
  "V10 additive ABI must stay explicitly bounded",
);
assert.ok(
  v10Abi.has("function:placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)"),
  "V10 must expose the epoch-bound bitmap entrypoint",
);
assert.ok(v10Abi.has("error:UnexpectedEpoch()"), "V10 must expose a deterministic stale-epoch error");

const functionSelectors = new Map();
for (const item of v10.abi.filter((candidate) => candidate.type === "function")) {
  const signature = `${item.name}(${item.inputs.map(({ type }) => type).join(",")})`;
  const selector = toFunctionSelector(signature);
  assert.ok(!functionSelectors.has(selector), `${signature} collides with ${functionSelectors.get(selector)}`);
  functionSelectors.set(selector, signature);
}

const runtimeBytes = v10.evm.deployedBytecode.object.length / 2;
const creationBytes = v10.evm.bytecode.object.length / 2;
const deploymentInitCodeBytes = creationBytes + V10_CONSTRUCTOR_ARGUMENT_BYTES;
assert.ok(runtimeBytes < EIP_170_RUNTIME_LIMIT, "V10 runtime must stay below the EIP-170 limit");
assert.ok(EIP_170_RUNTIME_LIMIT - runtimeBytes >= 8_000, "V10 must retain at least 8 KB of runtime headroom");
assert.ok(deploymentInitCodeBytes <= EIP_3860_INITCODE_LIMIT, "V10 deployment initcode must stay within EIP-3860");
assert.match(v10.evm.deployedBytecode.opcodes, /\bTLOAD\b/, "V10 must use transient storage for the guard");
assert.match(v10.evm.deployedBytecode.opcodes, /\bTSTORE\b/, "V10 must use transient storage for the guard");

const runtimeWithMetadata = Buffer.from(v10.evm.deployedBytecode.object, "hex");
const metadataLength = runtimeWithMetadata.readUInt16BE(runtimeWithMetadata.length - 2);
const executableRuntime = runtimeWithMetadata.subarray(0, runtimeWithMetadata.length - metadataLength - 2);
assert.equal(
  executableRuntime.length,
  v10CompilationManifest.executableRuntimeBytes,
  "V10 manifest must pin executable runtime size without Solidity metadata",
);
const runtimeIdentityReferences = v10CompilationManifest.runtimeImmutableReferences;
assert.equal(runtimeIdentityReferences.length, 16, "V10 manifest must pin every token immutable occurrence");
const normalizedExecutableRuntime = Buffer.from(executableRuntime);
let previousImmutableEnd = 0;
for (const reference of runtimeIdentityReferences) {
  assert.equal(reference.length, 32, "V10 runtime immutable must occupy one ABI word");
  assert.ok(reference.start >= previousImmutableEnd, "V10 runtime immutables must not overlap");
  assert.ok(reference.start + reference.length <= normalizedExecutableRuntime.length, "V10 runtime immutable is out of bounds");
  normalizedExecutableRuntime.fill(0, reference.start, reference.start + reference.length);
  previousImmutableEnd = reference.start + reference.length;
}
const normalizedExecutableRuntimeSha256 = createHash("sha256")
  .update(normalizedExecutableRuntime.toString("hex"))
  .digest("hex");
assert.equal(
  normalizedExecutableRuntimeSha256,
  v10CompilationManifest.normalizedExecutableRuntimeSha256,
  "V10 manifest must pin normalized executable runtime identity",
);
const tamperedExecutableRuntime = Buffer.from(normalizedExecutableRuntime);
tamperedExecutableRuntime[0] ^= 1;
assert.notEqual(
  createHash("sha256").update(tamperedExecutableRuntime.toString("hex")).digest("hex"),
  v10CompilationManifest.normalizedExecutableRuntimeSha256,
  "one executable byte change must fail the V10 runtime identity",
);
const forbiddenOpcodes = new Map([
  [0x32, "ORIGIN"],
  [0xf0, "CREATE"],
  [0xf2, "CALLCODE"],
  [0xf4, "DELEGATECALL"],
  [0xf5, "CREATE2"],
  [0xff, "SELFDESTRUCT"],
]);
for (let offset = 0; offset < executableRuntime.length; offset += 1) {
  const opcode = executableRuntime[offset];
  assert.ok(!forbiddenOpcodes.has(opcode), `V10 runtime must not contain ${forbiddenOpcodes.get(opcode)}`);
  if (opcode >= 0x60 && opcode <= 0x7f) offset += opcode - 0x5f;
}
assert.ok(
  !v10.abi.some((item) =>
    item.type === "receive" || item.type === "fallback" || item.stateMutability === "payable"),
  "V10 must not expose a native-ETH receiving surface",
);

const storage = new Map(v10.storageLayout.storage.map((entry) => [entry.label, entry]));
assert.equal(storage.get("_epochClockData")?.type, "t_uint256", "epoch clock must occupy one uint256 slot");
assert.ok(storage.has("_epochs"), "V10 must retain per-epoch financial accounting");
assert.ok(storage.has("tilePools"), "V10 must retain tile pool accounting");
assert.ok(storage.has("userBets"), "V10 must retain per-user bet accounting");
assert.ok(!storage.has("hasClaimed"), "reward claimed state must not allocate a second mapping slot");
assert.ok(storage.has("_userEpochRebateData"), "rebate volume and claimed state must share one storage word");
assert.ok(!storage.has("userEpochVolumes"), "the compatibility getter must not allocate a duplicate public mapping");
assert.ok(!storage.has("rebateClaimed"), "the compatibility getter must not allocate a second claimed-state mapping");
assert.ok(!storage.has("tileUserCounts"), "unique-player counts must not consume per-bet storage");
assert.ok(!storage.has("epochResolvedAt"), "resolved timestamp must be packed into epoch metadata");
assert.ok(!storage.has("epochDustSettled"), "reward dust flag must be packed into epoch metadata");
assert.ok(storage.has("_jackpotCheckTimestamps"), "daily and weekly jackpot checks must share one storage word");
assert.ok(!storage.has("lastDailyJackpotCheckTs"), "daily jackpot checks must not allocate a standalone slot");
assert.ok(!storage.has("lastWeeklyJackpotCheckTs"), "weekly jackpot checks must not allocate a standalone slot");
assert.ok(storage.has("_lastDailyJackpotData"), "daily jackpot period and epoch must share one storage word");
assert.ok(storage.has("_lastWeeklyJackpotData"), "weekly jackpot period and epoch must share one storage word");
for (const label of [
  "lastDailyJackpotDay",
  "lastWeeklyJackpotWeek",
  "lastDailyJackpotEpoch",
  "lastWeeklyJackpotEpoch",
]) {
  assert.ok(!storage.has(label), `${label} must remain a compatibility getter without a standalone slot`);
}
assert.match(extractFunctionBody(v10Source, "lastDailyJackpotDay"), /uint128\(_lastDailyJackpotData\)/);
assert.match(extractFunctionBody(v10Source, "lastWeeklyJackpotWeek"), /uint128\(_lastWeeklyJackpotData\)/);
assert.match(
  extractFunctionBody(v10Source, "lastDailyJackpotEpoch"),
  /uint96\(_lastDailyJackpotData\s*>>\s*JACKPOT_AWARD_EPOCH_SHIFT\)/,
);
assert.match(
  extractFunctionBody(v10Source, "lastWeeklyJackpotEpoch"),
  /uint96\(_lastWeeklyJackpotData\s*>>\s*JACKPOT_AWARD_EPOCH_SHIFT\)/,
);
const epochsStorageType = v10.storageLayout.types[storage.get("_epochs").type];
const epochStruct = v10.storageLayout.types[epochsStorageType.value];
assert.deepEqual(
  epochStruct.members.map(({ label, type }) => [label, type]),
  [["totalPool", "t_uint256"], ["rewardPool", "t_uint256"], ["resolutionData", "t_uint256"]],
  "Epoch must use two full-width financial slots plus one metadata slot",
);

for (const name of [
  "GRID_SIZE",
  "DAILY_JACKPOT_PERCENT",
  "WEEKLY_JACKPOT_PERCENT",
  "PROTOCOL_FEE_PERCENT",
  "BURN_FEE_PERCENT",
  "RESOLVER_REWARD_BPS",
  "BPS_DENOMINATOR",
  "FEE_FLUSH_INTERVAL_EPOCHS",
  "EPOCH_DURATION_TIMELOCK",
  "FEE_RECIPIENT_TIMELOCK",
  "DUST_SETTLE_DELAY",
  "LAST_BET_GRACE_SECONDS",
  "MONDAY_OFFSET",
]) {
  assert.equal(constantExpression(v10Source, name), constantExpression(v9Source, name), `${name} must remain unchanged`);
}
for (const [name, expected] of Object.entries({
  DAILY_JACKPOT_PERCENT: "2",
  WEEKLY_JACKPOT_PERCENT: "3",
  PROTOCOL_FEE_PERCENT: "2",
  BURN_FEE_PERCENT: "1",
  RESOLVER_REWARD_BPS: "5",
  BPS_DENOMINATOR: "10_000",
})) {
  assert.equal(constantExpression(v10Source, name), expected, `${name} must match the approved V10 tokenomics`);
}
const normalizeMulDiv = (body) => body
  .replace(/Math\.mulDiv\(\s*([^,]+),\s*([^,]+),\s*([^\)]+)\)/g, "($1 * $2) / $3")
  .replace(/\s+/g, "");
const normalizeSplitFees = (body) => normalizeMulDiv(body)
  .replace("uint256freshPool=ep.totalPool;", "")
  .replaceAll("ep.totalPool", "freshPool")
  .replace("dailyJackpotPool=dailyPool+dailyAccrual;", "dailyJackpotPool+=dailyAccrual;")
  .replace("weeklyJackpotPool=weeklyPool+weeklyAccrual;", "weeklyJackpotPool+=weeklyAccrual;");
assert.equal(
  normalizeSplitFees(extractFunctionBody(v10Source, "_splitFees")),
  normalizeSplitFees(extractFunctionBody(v9Source, "_splitFees")),
  "fee and rollover arithmetic must remain equivalent after full-precision normalization",
);
assert.equal(
  extractFunctionBody(v10Source, "_accrueProtocolFee").replace(/\s+/g, ""),
  extractFunctionBody(v9Source, "_accrueProtocolFee").replace(/\s+/g, ""),
  "Safety Pool and owner fee split must remain unchanged",
);

const nonReentrantMutations = [
  "claimResolverRewards",
  "flushProtocolFees",
  "claimEpochRebate",
  "claimEpochsRebate",
  "settleEpochDust",
  "settleEpochsDust",
  "settleEpochRebateDust",
  "settleEpochsRebateDust",
  "placeBet",
  "placeBatchBets",
  "placeBatchBetsSameAmount",
  "placeBatchBetsBitmap",
  "placeBatchBetsBitmapForEpoch",
  "resolveEpoch",
  "claimReward",
  "claimRewards",
];
for (const name of nonReentrantMutations) {
  assert.match(extractFunctionHeader(v10Source, name), /\bnonReentrant\b/, `${name} must remain nonReentrant`);
}

const ownerMutations = [
  "scheduleEpochDuration",
  "cancelEpochDurationChange",
  "scheduleFeeRecipientChange",
  "cancelFeeRecipientChange",
];
for (const name of ownerMutations) {
  assert.match(extractFunctionHeader(v10Source, name), /\bonlyOwner\b/, `${name} must remain owner-only`);
}

const stateChangingV10Functions = v10.abi
  .filter((item) => item.type === "function" && !["view", "pure"].includes(item.stateMutability))
  .map(canonicalAbiKey)
  .sort();
assert.deepEqual(
  stateChangingV10Functions,
  [
    "function:acceptOwnership()",
    "function:cancelEpochDurationChange()",
    "function:cancelFeeRecipientChange()",
    "function:claimEpochRebate(uint256)",
    "function:claimEpochsRebate(uint256[])",
    "function:claimResolverRewards()",
    "function:claimReward(uint256)",
    "function:claimRewards(uint256[])",
    "function:flushProtocolFees()",
    "function:placeBatchBets(uint256[],uint256[])",
    "function:placeBatchBetsBitmap(uint32,uint256)",
    "function:placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)",
    "function:placeBatchBetsSameAmount(uint256[],uint256)",
    "function:placeBet(uint256,uint256)",
    "function:resolveEpoch(uint256)",
    "function:scheduleEpochDuration(uint256)",
    "function:scheduleFeeRecipientChange(address)",
    "function:settleEpochDust(uint256)",
    "function:settleEpochRebateDust(uint256)",
    "function:settleEpochsDust(uint256[])",
    "function:settleEpochsRebateDust(uint256[])",
    "function:transferOwnership(address)",
  ].sort(),
  "every state-changing ABI entrypoint must stay explicitly classified",
);
const documentedV10Methods = new Set([
  ...Object.keys(v10.devdoc?.methods ?? {}),
  ...Object.keys(v10.userdoc?.methods ?? {}),
]);
const undocumentedStateChangingV10Functions = stateChangingV10Functions
  .map((key) => key.slice("function:".length))
  .filter((signature) => !documentedV10Methods.has(signature));
assert.deepEqual(
  undocumentedStateChangingV10Functions,
  [],
  "every state-changing ABI entrypoint must have NatSpec documentation",
);
const locallyDeclaredV10FunctionNames = new Set(
  [...v10Source.matchAll(/^\s*function\s+([A-Za-z_]\w*)\s*\(/gm)].map((match) => match[1]),
);
const guardedLocalMutationEntrypoints = v10.abi
  .filter(
    (candidate) =>
      candidate.type === "function" &&
      !["view", "pure"].includes(candidate.stateMutability) &&
      locallyDeclaredV10FunctionNames.has(candidate.name),
  )
  .map((item) => item.name)
  .sort();
assert.deepEqual(
  guardedLocalMutationEntrypoints,
  [...nonReentrantMutations, ...ownerMutations].sort(),
  "every locally declared state-changing entrypoint must be classified as nonReentrant or owner-only",
);
const undocumentedStateChangingV10Parameters = [];
let documentedStateChangingParameters = 0;
for (const item of v10.abi.filter(
  (candidate) =>
    candidate.type === "function" &&
    !["view", "pure"].includes(candidate.stateMutability) &&
    locallyDeclaredV10FunctionNames.has(candidate.name),
)) {
  const signature = `${item.name}(${item.inputs.map(({ type }) => type).join(",")})`;
  const documentedParameters = v10.devdoc?.methods?.[signature]?.params ?? {};
  for (const input of item.inputs) {
    if (!Object.hasOwn(documentedParameters, input.name)) {
      undocumentedStateChangingV10Parameters.push(`${signature}:${input.name}`);
    }
    documentedStateChangingParameters += 1;
  }
}
assert.deepEqual(
  undocumentedStateChangingV10Parameters,
  [],
  "every parameter of a locally declared state-changing ABI entrypoint must have NatSpec documentation",
);

for (const name of ["placeBet", "placeBatchBets", "placeBatchBetsSameAmount", "placeBatchBetsBitmap"]) {
  assert.match(
    extractFunctionHeader(v10Source, name),
    /\bexternal\b[\s\S]*\bnonReentrant\b/,
    `${name} must remain an external non-reentrant staking entrypoint`,
  );
  const body = extractFunctionBody(v10Source, name);
  assert.equal(body.match(/_prepareBetEpoch\(/g)?.length, 1, `${name} must prepare and cache its epoch exactly once`);
  assert.doesNotMatch(body, /currentEpoch\s*\(/, `${name} must not re-read the epoch after token interaction`);
  assert.equal(body.match(/token\.safeTransferFrom\(/g)?.length, 1, `${name} must use exactly one SafeERC20 transferFrom`);
  assert.ok(body.indexOf("ZeroAmount") < body.indexOf("_prepareBetEpoch"), `${name} must reject zero amounts before epoch work`);
  assert.ok(body.indexOf("_prepareBetEpoch") < body.indexOf("token.safeTransferFrom"), `${name} must prepare the epoch before transfer`);
}
const epochBoundBitmapBody = extractFunctionBody(v10Source, "placeBatchBetsBitmapForEpoch");
assert.match(
  extractFunctionHeader(v10Source, "placeBatchBetsBitmapForEpoch"),
  /\bexternal\b[\s\S]*\bnonReentrant\b/,
  "epoch-bound bitmap bets must remain an external non-reentrant staking entrypoint",
);
assert.equal(
  epochBoundBitmapBody.match(/_prepareObservedBetEpoch\(/g)?.length,
  1,
  "epoch-bound bitmap bets must prepare and cache the observed epoch exactly once",
);
assert.doesNotMatch(
  epochBoundBitmapBody,
  /_prepareBetEpoch\(/,
  "epoch-bound bitmap bets must not use the unbound legacy epoch preparation path",
);
assert.ok(
  epochBoundBitmapBody.indexOf("InvalidTileMask") < epochBoundBitmapBody.indexOf("_prepareObservedBetEpoch"),
  "epoch-bound bitmap bets must validate the mask before epoch work",
);
assert.ok(
  epochBoundBitmapBody.indexOf("ZeroAmount") < epochBoundBitmapBody.indexOf("_prepareObservedBetEpoch"),
  "epoch-bound bitmap bets must validate the amount before epoch work",
);
assert.ok(
  epochBoundBitmapBody.indexOf("_prepareObservedBetEpoch") < epochBoundBitmapBody.indexOf("token.safeTransferFrom"),
  "epoch-bound bitmap bets must validate the epoch window before token transfer",
);
assert.equal(
  epochBoundBitmapBody.match(/token\.safeTransferFrom\(/g)?.length,
  1,
  "epoch-bound bitmap bets must use exactly one SafeERC20 transferFrom",
);
for (const name of ["placeBatchBets", "placeBatchBetsSameAmount"]) {
  const body = extractFunctionBody(v10Source, name).replace(/\s+/g, " ");
  assert.doesNotMatch(
    body,
    /\b(?:seen|dedupe|deduplicat|selectedTiles|tileMask)\b/i,
    `${name} must preserve duplicate calldata entries as additive bets instead of silently deduplicating them`,
  );
  assert.ok(
    body.indexOf("token.safeTransferFrom") < body.indexOf("_recordBet(epoch, msg.sender, tileIds[i]"),
    `${name} must collect the aggregate transfer before replaying every calldata entry into additive bet accounting`,
  );
}
const countSelectedTilesBody = extractFunctionBody(v10Source, "_countSelectedTiles").replace(/\s+/g, " ");
assert.match(countSelectedTilesBody, /return uint256\(value & 0x3F\)/);
for (const name of ["placeBatchBetsBitmap", "placeBatchBetsBitmapForEpoch"]) {
  const body = extractFunctionBody(v10Source, name).replace(/\s+/g, " ");
  const maskCountIndex = body.indexOf("uint256 tileCount = _countSelectedTiles(tileMask)");
  const totalIndex = body.indexOf("uint256 totalAmount = amount * tileCount");
  const transferIndex = body.indexOf("token.safeTransferFrom(msg.sender, address(this), totalAmount)");
  const remainingMaskIndex = body.indexOf("uint32 remainingMask = tileMask");
  const recordIndex = body.indexOf("_recordBet(epoch, msg.sender, tileId, amount)");
  assert.notEqual(maskCountIndex, -1, `${name} must count unique bitmap-selected tiles`);
  assert.notEqual(totalIndex, -1, `${name} total must be derived from the bitmap popcount`);
  assert.notEqual(remainingMaskIndex, -1, `${name} must iterate over the original bitmap without mutating calldata`);
  assert.notEqual(recordIndex, -1, `${name} must record each selected bit exactly once`);
  assert.ok(maskCountIndex < totalIndex && totalIndex < transferIndex, `${name} must price the deduped bitmap before transfer`);
  assert.ok(
    transferIndex < remainingMaskIndex && remainingMaskIndex < recordIndex,
    `${name} must collect once, then materialize every selected bitmap bit into bet accounting`,
  );
  assert.match(body, /while \(remainingMask != 0\) \{ if \(\(remainingMask & 1\) == 1\)/);
  assert.match(body, /remainingMask >>= 1; unchecked \{ \+\+tileId; \}/);
}
const expectedEpochBody = extractFunctionBody(v10Source, "_prepareObservedBetEpoch");
assert.match(expectedEpochBody, /EpochClock memory clock = _loadEpochClock\(\)/);
assert.ok(expectedEpochBody.indexOf("UnexpectedEpoch") < expectedEpochBody.indexOf("EpochClosing"));
assert.ok(expectedEpochBody.indexOf("totalPool != 0") < expectedEpochBody.indexOf("_resolveCurrentEpoch(clock)"));
assert.ok(expectedEpochBody.indexOf("_resolveCurrentEpoch(clock)") < expectedEpochBody.indexOf("return clock.epoch + 1"));
assert.doesNotMatch(expectedEpochBody, /safeTransfer|_storeEpochClock/);
assert.match(expectedEpochBody, /return clock\.epoch/);
for (const [name, errorName] of [
  ["placeBet", "InvalidTile"],
  ["placeBatchBets", "InvalidTile"],
  ["placeBatchBetsSameAmount", "InvalidTile"],
  ["placeBatchBetsBitmap", "InvalidTileMask"],
]) {
  const body = extractFunctionBody(v10Source, name);
  assert.ok(body.indexOf(errorName) < body.indexOf("_prepareBetEpoch"), `${name} must validate targets before epoch work`);
}
const prepareBody = extractFunctionBody(v10Source, "_prepareBetEpoch");
assert.ok(
  prepareBody.indexOf("_resolveCurrentEpoch(clock)") < prepareBody.indexOf("LAST_BET_GRACE_SECONDS"),
  "expired epochs must resolve before the new epoch grace-window check",
);
const resolveBody = extractFunctionBody(v10Source, "_resolveCurrentEpoch");
const externalResolveBody = extractFunctionBody(v10Source, "resolveEpoch");
assert.doesNotMatch(
  externalResolveBody,
  /_isResolved/,
  "resolveEpoch must rely on the mandatory internal guard instead of paying for a duplicate storage read",
);
assert.match(resolveBody, /if\s*\(_isResolved\(ep\)\)\s*revert\s+AlreadyResolved\(\)/);
assert.match(resolveBody, /uint256 freshPool\s*=\s*ep\.totalPool/);
assert.match(resolveBody, /uint256 dailyPool\s*=\s*dailyJackpotPool/);
assert.match(resolveBody, /uint256 weeklyPool\s*=\s*weeklyJackpotPool/);
assert.match(resolveBody, /_splitFees\(L,\s*freshPool,\s*dailyPool,\s*weeklyPool\)/);
const splitFeesBody = extractFunctionBody(v10Source, "_splitFees");
assert.doesNotMatch(splitFeesBody, /ep\.totalPool/, "fee splitting must not reload the already cached fresh pool");
assert.match(splitFeesBody, /dailyJackpotPool\s*=\s*dailyPool\s*\+\s*dailyAccrual/);
assert.match(splitFeesBody, /weeklyJackpotPool\s*=\s*weeklyPool\s*\+\s*weeklyAccrual/);
assert.ok(resolveBody.indexOf("_splitFees") < resolveBody.indexOf("ep.resolutionData"));
assert.ok(resolveBody.indexOf("ep.resolutionData") < resolveBody.indexOf("emit EpochResolved"));
assert.ok(resolveBody.indexOf("ep.resolutionData") < resolveBody.indexOf("_storeEpochClock"));
assert.equal(resolveBody.includes("_flushProtocolFees"), false, "resolve must not depend on protocol fee transfers");
assert.match(extractFunctionBody(v10Source, "flushProtocolFees"), /_flushProtocolFees\(\)/);
assert.match(resolveBody, /block\.prevrandao/);
assert.match(resolveBody, /blockhash\(block\.number\s*-\s*1\)/);
const winningTileExpression = (source) => {
  const body = extractFunctionBody(source, "_resolveCurrentEpoch");
  const start = body.indexOf("L.winningTile =");
  const end = body.indexOf(";", start) + 1;
  assert.ok(start >= 0 && end > start, "missing winning-tile expression");
  return body
    .slice(start, end)
    .replace(/\bdailyPool\b/g, "dailyJackpotPool")
    .replace(/\bweeklyPool\b/g, "weeklyJackpotPool")
    .replace(/\s+/g, "");
};
assert.equal(
  winningTileExpression(v10Source),
  winningTileExpression(v9Source),
  "V10 winning-tile entropy inputs must remain identical to V9",
);
const normalizedJackpotBody = (source) => {
  let body = extractFunctionBody(source, "_tryAwardJackpots");
  return body
    .replace(/uint128\(_lastDailyJackpotData\)/g, "lastDailyJackpotDay")
    .replace(/uint128\(_lastWeeklyJackpotData\)/g, "lastWeeklyJackpotWeek")
    .replace(
      /_lastDailyJackpotData\s*=\s*today\s*\|\s*\(epoch\s*<<\s*JACKPOT_AWARD_EPOCH_SHIFT\)\s*;/g,
      "lastDailyJackpotDay = today; lastDailyJackpotEpoch = epoch;",
    )
    .replace(
      /_lastWeeklyJackpotData\s*=\s*thisWeek\s*\|\s*\(epoch\s*<<\s*JACKPOT_AWARD_EPOCH_SHIFT\)\s*;/g,
      "lastWeeklyJackpotWeek = thisWeek; lastWeeklyJackpotEpoch = epoch;",
    )
    .replace(/uint256 thisWeek\s*=\s*_mondayWeek\(block\.timestamp\)\s*;/g, "")
    .replace(/\bthisWeek\b/g, "_mondayWeek(block.timestamp)")
    .replace(
      /if\s*\(\s*\(lastDailyJackpotDay\s*==\s*today\s*\|\|\s*dailyJackpotPool\s*==\s*0\)\s*&&\s*\(lastWeeklyJackpotWeek\s*==\s*_mondayWeek\(block\.timestamp\)\s*\|\|\s*weeklyJackpotPool\s*==\s*0\)\s*\)\s*return\s*\(0\s*,\s*0\)\s*;/gs,
      "",
    )
    .replace(/uint256 previousCheckTimestamps\s*=\s*_jackpotCheckTimestamps\s*;/g, "")
    .replace(/uint256 dailyCheckTs\s*=\s*uint128\(previousCheckTimestamps\)\s*;/g, "")
    .replace(
      /uint256 weeklyCheckTs\s*=\s*previousCheckTimestamps\s*>>\s*WEEKLY_JACKPOT_CHECK_SHIFT\s*;/g,
      "",
    )
    .replace(
      /uint256 nextCheckTimestamps\s*=\s*dailyCheckTs\s*\|\s*\(weeklyCheckTs\s*<<\s*WEEKLY_JACKPOT_CHECK_SHIFT\)\s*;\s*if\s*\(nextCheckTimestamps\s*!=\s*previousCheckTimestamps\)\s*\{\s*_jackpotCheckTimestamps\s*=\s*nextCheckTimestamps\s*;\s*\}/gs,
      "",
    )
    .replace(/\bdailyCheckTs\b/g, "lastDailyJackpotCheckTs")
    .replace(/\bweeklyCheckTs\b/g, "lastWeeklyJackpotCheckTs")
    .replace(/ep\.isDailyJackpot\s*=\s*true\s*;/g, "flags |= DAILY_JACKPOT_FLAG;")
    .replace(/ep\.isWeeklyJackpot\s*=\s*true\s*;/g, "flags |= WEEKLY_JACKPOT_FLAG;")
    .replace(/\s+/g, "");
};
assert.equal(
  normalizedJackpotBody(v10Source),
  normalizedJackpotBody(v9Source),
  "V10 jackpot timing and probability logic must remain identical to V9",
);
assert.equal(
  (extractFunctionBody(v10Source, "_tryAwardJackpots").match(/_mondayWeek\(block\.timestamp\)/g) ?? []).length,
  1,
  "V10 jackpot checks must cache the current week exactly once",
);
assert.match(v10Source, /@openzeppelin\/contracts\/utils\/math\/Math\.sol/);
assert.equal((v10Source.match(/Math\.mulDiv\(/g) ?? []).length, 8, "all fractional accounting must use full-precision mulDiv");
for (const name of ["_splitFees", "claimReward", "claimRewards", "_previewRebateFromData"]) {
  assert.match(extractFunctionBody(v10Source, name), /Math\.mulDiv\(/, `${name} must avoid intermediate multiplication overflow`);
}

const recordBetBody = extractFunctionBody(v10Source, "_recordBet");
assert.doesNotMatch(recordBetBody, /tileUserCounts/, "bet recording must not write indexed presentation data");
assert.match(recordBetBody, /uint256 previousBet = userBets\[epoch\]\[tileId\]\[user\]/);
assert.match(recordBetBody, /userBets\[epoch\]\[tileId\]\[user\]\s*=\s*previousBet\s*\+\s*amount/);
assert.match(recordBetBody, /tilePools\[epoch\]\[tileId\]\s*\+=\s*amount/);
assert.match(extractFunctionBody(v10Source, "tileUserCounts"), /return\s+0\s*;/);
assert.doesNotMatch(extractFunctionBody(v10Source, "getTileData"), /tileUserCounts/);
const hasClaimedBody = extractFunctionBody(v10Source, "hasClaimed");
assert.match(hasClaimedBody, /_userEpochRebateData\[epoch\]\[user\]\s*&\s*REWARD_CLAIMED_FLAG/);
const claimRewardBody = extractFunctionBody(v10Source, "claimReward");
assert.match(claimRewardBody, /userData\s*&\s*REWARD_CLAIMED_FLAG/);
assert.match(claimRewardBody, /_userEpochRebateData\[epoch\]\[msg\.sender\]\s*=\s*userData\s*\|\s*REWARD_CLAIMED_FLAG/);
assert.doesNotMatch(claimRewardBody, /\bhasClaimed\s*\[/);
assert.ok(
  claimRewardBody.indexOf("_userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG") <
    claimRewardBody.indexOf("token.safeTransfer"),
  "single reward claim must close packed claimed state before transfer",
);
const claimRewardsBody = extractFunctionBody(v10Source, "claimRewards");
assert.match(claimRewardsBody, /userData\s*&\s*REWARD_CLAIMED_FLAG/);
assert.match(claimRewardsBody, /_userEpochRebateData\[epoch\]\[msg\.sender\]\s*=\s*userData\s*\|\s*REWARD_CLAIMED_FLAG/);
assert.doesNotMatch(claimRewardsBody, /\bhasClaimed\s*\[/);
assert.ok(
  claimRewardsBody.indexOf("_userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG") <
    claimRewardsBody.indexOf("token.safeTransfer"),
  "batch reward claims must close every packed claimed state before aggregate transfer",
);
const batchRewardClaimGuardIndex = claimRewardsBody.indexOf("(userData & REWARD_CLAIMED_FLAG) == 0");
const batchRewardClaimCloseIndex = claimRewardsBody.indexOf(
  "_userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG",
);
const batchRewardTotalIndex = claimRewardsBody.indexOf("totalReward += reward");
const batchRewardCountIndex = claimRewardsBody.indexOf("epochsClaimedCount += 1");
const batchRewardPerEpochEventIndex = claimRewardsBody.indexOf("emit RewardClaimed(epoch, msg.sender, reward)");
const batchRewardTransferIndex = claimRewardsBody.indexOf("token.safeTransfer(msg.sender, totalReward)");
const batchRewardAggregateEventIndex = claimRewardsBody.indexOf("emit RewardBatchClaimed(msg.sender, totalReward, epochsClaimedCount)");
assert.notEqual(batchRewardClaimGuardIndex, -1, "batch reward claims must skip already claimed duplicate entries");
assert.notEqual(batchRewardClaimCloseIndex, -1, "batch reward claims must close packed claimed state");
assert.notEqual(batchRewardTotalIndex, -1, "batch reward claims must aggregate only closed payable epochs");
assert.notEqual(batchRewardCountIndex, -1, "batch reward claims must count only closed payable epochs");
assert.notEqual(batchRewardPerEpochEventIndex, -1, "batch reward claims must emit per-epoch claim evidence");
assert.notEqual(batchRewardTransferIndex, -1, "batch reward claims must keep one aggregate transfer");
assert.notEqual(batchRewardAggregateEventIndex, -1, "batch reward claims must emit aggregate claim evidence");
assert.ok(
  batchRewardClaimGuardIndex < batchRewardClaimCloseIndex &&
    batchRewardClaimCloseIndex < batchRewardTotalIndex &&
    batchRewardClaimCloseIndex < batchRewardCountIndex,
  "batch reward claims must close duplicate state before aggregating a payable epoch",
);
assert.ok(
  batchRewardClaimCloseIndex < batchRewardPerEpochEventIndex &&
    batchRewardPerEpochEventIndex < batchRewardTransferIndex &&
    batchRewardTransferIndex < batchRewardAggregateEventIndex,
  "batch reward claims must order receipt evidence as state close, per-epoch event, aggregate transfer, aggregate event",
);
assert.match(extractFunctionBody(v10Source, "userEpochVolumes"), /_userEpochRebateData\[epoch\]\[user\]\s*&\s*USER_EPOCH_VOLUME_MASK/);
assert.match(extractFunctionBody(v10Source, "rebateClaimed"), /_userEpochRebateData\[epoch\]\[user\]\s*&\s*REBATE_CLAIMED_FLAG/);
const recordEpochVolumeBody = extractFunctionBody(v10Source, "_recordEpochVolume");
assert.match(recordEpochVolumeBody, /USER_EPOCH_VOLUME_MASK\s*-\s*volume/);
assert.match(recordEpochVolumeBody, /UserEpochVolumeOverflow/);
assert.match(recordEpochVolumeBody, /_userEpochRebateData\[epoch\]\[user\]/);
assert.match(recordEpochVolumeBody, /REBATE_CLAIMED_FLAG\s*\|\s*REWARD_CLAIMED_FLAG/);
assert.match(recordEpochVolumeBody, /_epochs\[epoch\]\.totalPool\s*\+=\s*totalAmount/);
const consumeRebateBody = extractFunctionBody(v10Source, "_consumeRebate");
assert.match(consumeRebateBody, /_previewRebateFromData\(epoch,\s*user,\s*userData,\s*resolutionData\)/);
assert.match(consumeRebateBody, /=\s*userData\s*\|\s*REBATE_CLAIMED_FLAG/);
const consumeRebateUserCloseIndex = consumeRebateBody.indexOf(
  "_userEpochRebateData[epoch][user] = userData | REBATE_CLAIMED_FLAG",
);
const consumeRebateAggregateCloseIndex = consumeRebateBody.indexOf("epochRebateClaimed[epoch] += amount");
const consumeRebatePreviewIndex = consumeRebateBody.indexOf("_previewRebateFromData(epoch, user, userData, resolutionData)");
const consumeRebateZeroGuardIndex = consumeRebateBody.indexOf("if (amount == 0) return 0");
assert.notEqual(consumeRebatePreviewIndex, -1, "rebate helper must compute the payable amount before closing state");
assert.notEqual(consumeRebateZeroGuardIndex, -1, "rebate helper must skip zero claims before closing state");
assert.notEqual(consumeRebateUserCloseIndex, -1, "rebate helper must close per-user claimed state");
assert.notEqual(consumeRebateAggregateCloseIndex, -1, "rebate helper must close aggregate claimed state");
assert.ok(
  consumeRebatePreviewIndex < consumeRebateZeroGuardIndex &&
    consumeRebateZeroGuardIndex < consumeRebateUserCloseIndex &&
    consumeRebateUserCloseIndex < consumeRebateAggregateCloseIndex,
  "rebate helper must compute the amount, skip zero claims, then close user and aggregate state",
);
const claimEpochsRebateBody = extractFunctionBody(v10Source, "claimEpochsRebate");
const batchRebateClaimGuardIndex = claimEpochsRebateBody.indexOf("(userData & REBATE_CLAIMED_FLAG) == 0");
const batchRebateClaimCloseIndex = claimEpochsRebateBody.indexOf(
  "_consumeRebate(epoch, msg.sender, userData, resolutionData)",
);
const batchRebateTotalIndex = claimEpochsRebateBody.indexOf("totalAmount += amount");
const batchRebateCountIndex = claimEpochsRebateBody.indexOf("epochsClaimedCount += 1");
const batchRebatePerEpochEventIndex = claimEpochsRebateBody.indexOf("emit RebateClaimed(msg.sender, epoch, amount)");
const batchRebateTransferIndex = claimEpochsRebateBody.indexOf("token.safeTransfer(msg.sender, totalAmount)");
const batchRebateAggregateEventIndex = claimEpochsRebateBody.indexOf("emit RebateBatchClaimed(msg.sender, totalAmount, epochsClaimedCount)");
assert.notEqual(batchRebateClaimGuardIndex, -1, "batch rebate claims must skip already claimed duplicate entries");
assert.notEqual(batchRebateClaimCloseIndex, -1, "batch rebate claims must close packed claimed state");
assert.notEqual(batchRebateTotalIndex, -1, "batch rebate claims must aggregate only closed payable epochs");
assert.notEqual(batchRebateCountIndex, -1, "batch rebate claims must count only closed payable epochs");
assert.notEqual(batchRebatePerEpochEventIndex, -1, "batch rebate claims must emit per-epoch claim evidence");
assert.notEqual(batchRebateTransferIndex, -1, "batch rebate claims must keep one aggregate transfer");
assert.notEqual(batchRebateAggregateEventIndex, -1, "batch rebate claims must emit aggregate claim evidence");
assert.ok(
  batchRebateClaimGuardIndex < batchRebateClaimCloseIndex &&
    batchRebateClaimCloseIndex < batchRebateTotalIndex &&
    batchRebateClaimCloseIndex < batchRebateCountIndex,
  "batch rebate claims must close duplicate state before aggregating a payable epoch",
);
assert.ok(
  batchRebateClaimCloseIndex < batchRebatePerEpochEventIndex &&
    batchRebatePerEpochEventIndex < batchRebateTransferIndex &&
    batchRebateTransferIndex < batchRebateAggregateEventIndex,
  "batch rebate claims must order receipt evidence as state close, per-epoch event, aggregate transfer, aggregate event",
);
const previewRebateFromDataBody = extractFunctionBody(v10Source, "_previewRebateFromData");
assert.match(previewRebateFromDataBody, /userData\s*&\s*REBATE_CLAIMED_FLAG/);
assert.match(previewRebateFromDataBody, /userData\s*&\s*USER_EPOCH_VOLUME_MASK/);
assert.match(previewRebateFromDataBody, /uint256 winningPool\s*=\s*tilePools\[epoch\]\[winningTile\]/);
assert.match(previewRebateFromDataBody, /uint256 losingVolume\s*=\s*totalPool\s*-\s*winningPool/);
assert.match(
  extractFunctionBody(v10Source, "previewRebate"),
  /_previewRebateFromData\([\s\S]*_userEpochRebateData\[epoch\]\[user\],[\s\S]*_epochs\[epoch\]\.resolutionData/,
);
const singleRewardExpiryIndex = claimRewardBody.indexOf("block.timestamp >= resolvedAt + DUST_SETTLE_DELAY");
const singleRewardDustFlagIndex = claimRewardBody.indexOf("resolutionData & REWARD_DUST_SETTLED_FLAG");
const singleRewardCloseIndex = claimRewardBody.indexOf("_userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG");
assert.notEqual(singleRewardExpiryIndex, -1, "single reward claim must close at the dust-settlement boundary");
assert.notEqual(singleRewardDustFlagIndex, -1, "single reward claim must reject after reward dust settlement");
assert.ok(
  singleRewardExpiryIndex < singleRewardCloseIndex && singleRewardDustFlagIndex < singleRewardCloseIndex,
  "single reward claim must reject late/dust-settled epochs before closing user claim state",
);
const batchRewardExpiryIndex = claimRewardsBody.indexOf("block.timestamp >= resolvedAt + DUST_SETTLE_DELAY");
const batchRewardDustFlagIndex = claimRewardsBody.indexOf("(resolutionData & REWARD_DUST_SETTLED_FLAG) == 0");
assert.notEqual(batchRewardExpiryIndex, -1, "batch reward claims must skip entries at the dust-settlement boundary");
assert.notEqual(batchRewardDustFlagIndex, -1, "batch reward claims must skip reward-dust-settled entries");
assert.ok(
  batchRewardDustFlagIndex < batchRewardClaimCloseIndex && batchRewardExpiryIndex < batchRewardClaimCloseIndex,
  "batch reward claims must evaluate late/dust-settled state before closing or aggregating payable epochs",
);
assert.match(
  previewRebateFromDataBody,
  /if\s*\(\s*resolvedAt\s*>\s*0\s*&&\s*block\.timestamp\s*>=\s*resolvedAt\s*\+\s*DUST_SETTLE_DELAY\s*\)\s*return\s+0\s*;/,
  "single and batch rebate claims must share the preview helper that closes exactly at the dust-settlement boundary",
);
for (const [name, helperName] of [
  ["claimEpochRebate", "_consumeRebate"],
  ["claimEpochsRebate", "_consumeRebate"],
]) {
  assert.match(extractFunctionBody(v10Source, name), new RegExp(`${helperName}\\(`), `${name} must route through the shared rebate preview/expiry helper`);
}
for (const [name, expectedGuard] of [
  ["settleEpochDust", "block.timestamp >= resolvedAt + DUST_SETTLE_DELAY"],
  ["settleEpochRebateDust", "block.timestamp >= resolvedAt + DUST_SETTLE_DELAY"],
]) {
  assert.match(
    extractFunctionBody(v10Source, name).replace(/\s+/g, " "),
    new RegExp(expectedGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")),
    `${name} must use the same DUST_SETTLE_DELAY boundary as late claim rejection`,
  );
}
for (const [name, helperName] of [
  ["settleEpochsDust", "_settleRewardDustIfAvailable"],
  ["settleEpochsRebateDust", "_settleRebateDustIfAvailable"],
]) {
  assert.match(extractFunctionBody(v10Source, name), new RegExp(`${helperName}\\(`), `${name} must route batch dust settlement through the shared boundary helper`);
}
assert.match(
  extractFunctionBody(v10Source, "_settleRewardDustIfAvailable").replace(/\s+/g, " "),
  /block\.timestamp < resolvedAt \+ DUST_SETTLE_DELAY/,
  "reward dust helper must share the late-reward-claim DUST_SETTLE_DELAY boundary",
);
assert.match(
  extractFunctionBody(v10Source, "_settleRebateDustIfAvailable").replace(/\s+/g, " "),
  /block\.timestamp < resolvedAt \+ DUST_SETTLE_DELAY/,
  "rebate dust helper must share the late-rebate-claim DUST_SETTLE_DELAY boundary",
);

const rewardClaimedFlag = 1n << 254n;
const rebateClaimedFlag = 1n << 255n;
const userEpochVolumeMask = rewardClaimedFlag - 1n;
const packedRebateRoundTripCases = [0n, 1n, 10n ** 18n, userEpochVolumeMask];
const packedRebateUpdateCases = [
  [0n, 1n],
  [1n, 10n ** 18n],
  [userEpochVolumeMask - 1n, 1n],
];
const packedRebateFlagCases = [0n, rewardClaimedFlag, rebateClaimedFlag, rewardClaimedFlag | rebateClaimedFlag];
for (const volume of packedRebateRoundTripCases) {
  const packed = rebateClaimedFlag | rewardClaimedFlag | volume;
  assert.equal(packed & userEpochVolumeMask, volume, "packed rebate volume must round-trip");
  assert.equal((packed & rebateClaimedFlag) !== 0n, true, "packed rebate claimed flag must round-trip");
  assert.equal((packed & rewardClaimedFlag) !== 0n, true, "packed reward claimed flag must round-trip");
}
for (const flags of packedRebateFlagCases) {
  for (const [volume, increment] of packedRebateUpdateCases) {
    const updated = flags | (volume + increment);
    assert.equal(updated & userEpochVolumeMask, volume + increment, "volume update must preserve its exact amount");
    assert.equal(updated & ~userEpochVolumeMask, flags, "volume update must preserve both claim flags");
    assert.equal((updated | rewardClaimedFlag) & userEpochVolumeMask, volume + increment);
    assert.equal((updated | rebateClaimedFlag) & userEpochVolumeMask, volume + increment);
  }
}

const financialExitClosures = new Map([
  ["claimResolverRewards", "pendingResolverRewards[msg.sender] = 0"],
  ["claimEpochRebate", "_consumeRebate("],
  ["claimEpochsRebate", "_consumeRebate("],
  ["settleEpochDust", "_settleRewardDustIfAvailable("],
  ["settleEpochsDust", "_settleRewardDustIfAvailable("],
  ["settleEpochRebateDust", "_settleRebateDustIfAvailable("],
  ["settleEpochsRebateDust", "_settleRebateDustIfAvailable("],
  ["claimReward", "_userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG"],
  ["claimRewards", "_userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG"],
]);
for (const [name, closure] of financialExitClosures) {
  assert.match(
    extractFunctionHeader(v10Source, name),
    /\bexternal\b[\s\S]*\bnonReentrant\b/,
    `${name} must remain an external non-reentrant financial exit`,
  );
  const body = extractFunctionBody(v10Source, name);
  const closureIndex = body.indexOf(closure);
  const transferIndex = body.indexOf("token.safeTransfer");
  assert.notEqual(closureIndex, -1, `${name} liability closure changed`);
  assert.notEqual(transferIndex, -1, `${name} token transfer is missing`);
  assert.ok(closureIndex < transferIndex, `${name} must close state before transfer`);
}
const singleFinancialExitEventOrder = new Map([
  [
    "claimResolverRewards",
    [
      "pendingResolverRewards[msg.sender] = 0",
      "token.safeTransfer(msg.sender, amount)",
      "emit ResolverRewardClaimed(msg.sender, amount)",
    ],
  ],
  [
    "claimEpochRebate",
    [
      "_consumeRebate(epoch, msg.sender, userData, resolutionData)",
      "token.safeTransfer(msg.sender, amount)",
      "emit RebateClaimed(msg.sender, epoch, amount)",
    ],
  ],
  [
    "claimReward",
    [
      "_userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG",
      "token.safeTransfer(msg.sender, reward)",
      "emit RewardClaimed(epoch, msg.sender, reward)",
    ],
  ],
]);
for (const [name, [closure, transfer, event]] of singleFinancialExitEventOrder) {
  const body = extractFunctionBody(v10Source, name);
  const closureIndex = body.indexOf(closure);
  const transferIndex = body.indexOf(transfer);
  const eventIndex = body.indexOf(event);
  assert.notEqual(closureIndex, -1, `${name} single-exit liability closure changed`);
  assert.notEqual(transferIndex, -1, `${name} single-exit transfer changed`);
  assert.notEqual(eventIndex, -1, `${name} single-exit event changed`);
  assert.ok(
    closureIndex < transferIndex && transferIndex < eventIndex,
    `${name} must order single-exit evidence as state close, transfer, event`,
  );
}
const previewRebateBody = extractFunctionBody(v10Source, "_previewRebateFromData");
assert.match(
  previewRebateBody.replace(/\s+/g, " "),
  /uint256 claimedTotal = epochRebateClaimed\[epoch\]; if \(totalPool == 0 \|\| rebatePool == 0 \|\| claimedTotal >= rebatePool\) return 0;[\s\S]*uint256 remaining = rebatePool - claimedTotal; return amount > remaining \? remaining : amount;/,
  "rebate preview must cap each proportional claim to the remaining rebate liability",
);
function assertFeeRecipientApplyBeforeTransfer(functionName, transferNeedle) {
  const body = extractFunctionBody(v10Source, functionName);
  const applyIndex = body.indexOf("_applyPendingFeeRecipientIfReady()");
  const transferIndex = body.indexOf(transferNeedle);
  assert.notEqual(applyIndex, -1, `${functionName} must apply matured fee-recipient changes before fee-recipient transfers`);
  assert.notEqual(transferIndex, -1, `${functionName} fee-recipient transfer changed`);
  assert.ok(applyIndex < transferIndex, `${functionName} must apply matured fee recipient before transferring to feeRecipient`);
}
for (const [functionName, transferNeedle] of [
  ["settleEpochDust", "token.safeTransfer(feeRecipient, dust)"],
  ["settleEpochsDust", "token.safeTransfer(feeRecipient, totalDust)"],
  ["settleEpochRebateDust", "token.safeTransfer(feeRecipient, dust)"],
  ["settleEpochsRebateDust", "token.safeTransfer(feeRecipient, totalDust)"],
]) {
  assertFeeRecipientApplyBeforeTransfer(functionName, transferNeedle);
}
const applyPendingFeeRecipientBody = extractFunctionBody(v10Source, "_applyPendingFeeRecipientIfReady");
for (const [first, second] of [
  ["address next = pendingFeeRecipient", "if (next == address(0)) return"],
  ["if (block.timestamp < pendingFeeRecipientEta) return", "address oldRecipient = feeRecipient"],
  ["feeRecipient = next", "pendingFeeRecipient = address(0)"],
  ["pendingFeeRecipient = address(0)", "pendingFeeRecipientEta = 0"],
  ["pendingFeeRecipientEta = 0", "emit FeeRecipientUpdated(oldRecipient, next)"],
]) {
  const firstIndex = applyPendingFeeRecipientBody.indexOf(first);
  const secondIndex = applyPendingFeeRecipientBody.indexOf(second);
  assert.notEqual(firstIndex, -1, `_applyPendingFeeRecipientIfReady changed: ${first}`);
  assert.notEqual(secondIndex, -1, `_applyPendingFeeRecipientIfReady changed: ${second}`);
  assert.ok(firstIndex < secondIndex, "_applyPendingFeeRecipientIfReady must clear pending state before emitting the update");
}
const applyPendingEpochDurationBody = extractFunctionBody(v10Source, "_applyPendingEpochDurationIfReady");
const scheduleEpochDurationBody = extractFunctionBody(v10Source, "_scheduleEpochDuration");
assert.match(
  scheduleEpochDurationBody,
  /if \(newDuration < 15 \|\| newDuration > 3600\) revert InvalidEpochDuration\(\)/,
  "epoch duration scheduling must keep the exact 15..3600 second boundary",
);
for (const [first, second] of [
  ["if (pendingEpochDuration == 0) return", "if (block.timestamp < pendingEpochDurationEta) return"],
  ["if (block.timestamp < pendingEpochDurationEta) return", "EpochClock memory clock = _loadEpochClock()"],
  ["if (clock.epoch < pendingEpochDurationEffectiveFromEpoch) return", "uint256 old = clock.duration"],
  ["uint256 old = clock.duration", "uint256 next = pendingEpochDuration"],
  ["uint256 next = pendingEpochDuration", "_storeEpochClock(next, clock.epoch, clock.startTime)"],
  ["_storeEpochClock(next, clock.epoch, clock.startTime)", "pendingEpochDuration = 0"],
  ["pendingEpochDuration = 0", "pendingEpochDurationEta = 0"],
  ["pendingEpochDurationEta = 0", "pendingEpochDurationEffectiveFromEpoch = 0"],
  ["pendingEpochDurationEffectiveFromEpoch = 0", "emit EpochDurationUpdated(old, next)"],
]) {
  const firstIndex = applyPendingEpochDurationBody.indexOf(first);
  const secondIndex = applyPendingEpochDurationBody.indexOf(second);
  assert.notEqual(firstIndex, -1, `_applyPendingEpochDurationIfReady changed: ${first}`);
  assert.notEqual(secondIndex, -1, `_applyPendingEpochDurationIfReady changed: ${second}`);
  assert.ok(firstIndex < secondIndex, "_applyPendingEpochDurationIfReady must clear pending state before emitting the update");
}
function simulateFeeRecipientTimelock({ pendingRecipient, eta, now, currentRecipient = "old" }) {
  if (!pendingRecipient) {
    return { feeRecipient: currentRecipient, pendingRecipient, eta, applied: false, event: null };
  }
  if (now < eta) {
    return { feeRecipient: currentRecipient, pendingRecipient, eta, applied: false, event: null };
  }
  return {
    feeRecipient: pendingRecipient,
    pendingRecipient: null,
    eta: 0n,
    applied: true,
    event: { oldRecipient: currentRecipient, newRecipient: pendingRecipient },
  };
}
function simulateEpochDurationTimelock({ pendingDuration, eta, effectiveFromEpoch, now, currentEpoch, epochDuration = 60n }) {
  if (pendingDuration === 0n) {
    return { epochDuration, pendingDuration, eta, effectiveFromEpoch, applied: false, event: null };
  }
  if (now < eta || currentEpoch < effectiveFromEpoch) {
    return { epochDuration, pendingDuration, eta, effectiveFromEpoch, applied: false, event: null };
  }
  return {
    epochDuration: pendingDuration,
    pendingDuration: 0n,
    eta: 0n,
    effectiveFromEpoch: 0n,
    applied: true,
    event: { newDuration: pendingDuration },
  };
}
function simulateEpochDurationSchedule(newDuration) {
  if (newDuration < 15n || newDuration > 3_600n) {
    return { accepted: false, reason: "InvalidEpochDuration" };
  }
  return { accepted: true, reason: null };
}
const epochDurationScheduleBoundaryCases = [
  [0n, false],
  [14n, false],
  [15n, true],
  [16n, true],
  [3_599n, true],
  [3_600n, true],
  [3_601n, false],
];
for (const [duration, accepted] of epochDurationScheduleBoundaryCases) {
  const result = simulateEpochDurationSchedule(duration);
  assert.equal(result.accepted, accepted, "epoch duration schedule boundary changed");
  assert.equal(result.reason, accepted ? null : "InvalidEpochDuration", "invalid epoch duration must fail closed with the documented error");
}
const feeRecipientEta = 1_000n;
const feeRecipientTimelockCases = [
  { pendingRecipient: null, eta: feeRecipientEta, now: feeRecipientEta + 1n, applied: false },
  { pendingRecipient: "next", eta: feeRecipientEta, now: feeRecipientEta - 1n, applied: false },
  { pendingRecipient: "next", eta: feeRecipientEta, now: feeRecipientEta, applied: true },
  { pendingRecipient: "next", eta: feeRecipientEta, now: feeRecipientEta + 1n, applied: true },
];
for (const modelCase of feeRecipientTimelockCases) {
  const result = simulateFeeRecipientTimelock(modelCase);
  assert.equal(result.applied, modelCase.applied, "fee recipient timelock must apply exactly at eta, not before");
  assert.equal(result.pendingRecipient === null, modelCase.applied || modelCase.pendingRecipient === null, "fee recipient apply must clear pending recipient only when applied");
}
const epochDurationEta = 2_000n;
const epochDurationEffectiveFromEpoch = 42n;
const epochDurationTimelockCases = [
  { pendingDuration: 0n, eta: epochDurationEta, now: epochDurationEta + 1n, currentEpoch: epochDurationEffectiveFromEpoch, applied: false },
  { pendingDuration: 90n, eta: epochDurationEta, now: epochDurationEta - 1n, currentEpoch: epochDurationEffectiveFromEpoch, applied: false },
  { pendingDuration: 90n, eta: epochDurationEta, now: epochDurationEta, currentEpoch: epochDurationEffectiveFromEpoch - 1n, applied: false },
  { pendingDuration: 90n, eta: epochDurationEta, now: epochDurationEta, currentEpoch: epochDurationEffectiveFromEpoch, applied: true },
  { pendingDuration: 90n, eta: epochDurationEta, now: epochDurationEta + 1n, currentEpoch: epochDurationEffectiveFromEpoch + 1n, applied: true },
];
for (const modelCase of epochDurationTimelockCases) {
  const result = simulateEpochDurationTimelock({ ...modelCase, effectiveFromEpoch: epochDurationEffectiveFromEpoch });
  assert.equal(result.applied, modelCase.applied, "epoch duration timelock must require eta and effective epoch before applying");
  assert.equal(result.pendingDuration === 0n, modelCase.applied || modelCase.pendingDuration === 0n, "epoch duration apply must clear pending duration only when applied");
}
const protocolFlushHeader = extractFunctionHeader(v10Source, "flushProtocolFees");
assert.match(
  protocolFlushHeader,
  /\bexternal\b[\s\S]*\bnonReentrant\b/,
  "protocol fee flush must remain an external non-reentrant financial exit",
);
const protocolFlushExternalBody = extractFunctionBody(v10Source, "flushProtocolFees");
const protocolFeeRecipientApplyIndex = protocolFlushExternalBody.indexOf("_applyPendingFeeRecipientIfReady()");
const protocolFlushInternalCallIndex = protocolFlushExternalBody.indexOf("_flushProtocolFees()");
assert.notEqual(protocolFeeRecipientApplyIndex, -1, "protocol fee flush must apply matured fee-recipient changes before owner-fee transfer");
assert.notEqual(protocolFlushInternalCallIndex, -1, "protocol fee flush wrapper must call the internal flush helper");
assert.ok(
  protocolFeeRecipientApplyIndex < protocolFlushInternalCallIndex,
  "protocol fee flush wrapper must apply matured fee recipient before internal token transfers",
);
const protocolFlushBody = extractFunctionBody(v10Source, "_flushProtocolFees");
const ownerTransferIndex = protocolFlushBody.indexOf("token.safeTransfer(feeRecipient, ownerAmount)");
const burnTransferIndex = protocolFlushBody.indexOf("token.safeTransfer(BURN_ADDRESS, burnAmount)");
const ownerPositiveBranchIndex = protocolFlushBody.indexOf("if (ownerAmount > 0)");
const burnPositiveBranchIndex = protocolFlushBody.indexOf("if (burnAmount > 0)");
const ownerAmountReadIndex = protocolFlushBody.indexOf("uint256 ownerAmount = accruedOwnerFees");
const burnAmountReadIndex = protocolFlushBody.indexOf("uint256 burnAmount = accruedBurnFees");
const ownerLiabilityCloseIndex = protocolFlushBody.indexOf("accruedOwnerFees = 0");
const burnLiabilityCloseIndex = protocolFlushBody.indexOf("accruedBurnFees = 0");
const protocolFeeEventIndex = protocolFlushBody.indexOf("emit ProtocolFeesFlushed");
assert.notEqual(ownerPositiveBranchIndex, -1, "protocol owner fee flush must keep a positive-amount branch");
assert.notEqual(burnPositiveBranchIndex, -1, "protocol burn fee flush must keep a positive-amount branch");
assert.notEqual(ownerAmountReadIndex, -1, "protocol owner fee flush must read the liability before closing it");
assert.notEqual(burnAmountReadIndex, -1, "protocol burn fee flush must read the liability before closing it");
assert.notEqual(ownerLiabilityCloseIndex, -1, "protocol owner fee liability closure changed");
assert.notEqual(burnLiabilityCloseIndex, -1, "protocol burn fee liability closure changed");
assert.notEqual(ownerTransferIndex, -1, "protocol owner fee transfer is missing");
assert.notEqual(burnTransferIndex, -1, "protocol burn fee transfer is missing");
assert.ok(protocolFlushBody.indexOf("accruedOwnerFees = 0") < ownerTransferIndex, "owner fee liability must close before transfer");
assert.ok(protocolFlushBody.indexOf("accruedBurnFees = 0") < burnTransferIndex, "burn fee liability must close before transfer");
assert.ok(
  ownerPositiveBranchIndex < ownerLiabilityCloseIndex &&
    ownerAmountReadIndex < ownerLiabilityCloseIndex &&
    ownerLiabilityCloseIndex < ownerTransferIndex &&
    ownerTransferIndex < burnPositiveBranchIndex,
  "protocol owner fee flush must read, close, and transfer only inside the owner positive branch before the burn branch",
);
assert.ok(
  burnPositiveBranchIndex < burnLiabilityCloseIndex &&
    burnAmountReadIndex < burnLiabilityCloseIndex &&
    burnLiabilityCloseIndex < burnTransferIndex,
  "protocol burn fee flush must read, close, and transfer only inside the burn positive branch",
);
assert.ok(
  protocolFeeEventIndex > burnTransferIndex,
  "protocol fee event must follow both atomic transfers",
);
for (const name of ["claimReward", "claimRewards", "_previewRebateFromData"]) {
  const body = extractFunctionBody(v10Source, name);
  if (name !== "_previewRebateFromData") {
    assert.match(body, /uint256 resolutionData\s*=\s*ep\.resolutionData/);
  }
  assert.doesNotMatch(
    body,
    /_(?:isResolved|resolvedAt|winningTile|hasResolutionFlag)\(ep/,
    `${name} must unpack its cached resolution word without repeated storage helpers`,
  );
}
const rewardDustBody = extractFunctionBody(v10Source, "_settleRewardDustIfAvailable");
assert.ok(rewardDustBody.indexOf("REWARD_DUST_SETTLED_FLAG") < rewardDustBody.indexOf("emit RewardDustSettled"));
assert.match(rewardDustBody, /uint256 resolutionData\s*=\s*ep\.resolutionData/);
assert.doesNotMatch(rewardDustBody, /_(?:isResolved|resolvedAt|hasResolutionFlag)\(ep/);
assert.match(rewardDustBody, /=\s*resolutionData\s*\|\s*REWARD_DUST_SETTLED_FLAG/);
const settleEpochDustBody = extractFunctionBody(v10Source, "settleEpochDust");
assert.doesNotMatch(
  settleEpochDustBody,
  /if\s*\(\s*dust\s*==\s*0\s*\)\s*revert/,
  "single reward dust settlement must still close an expired epoch with zero remainder",
);
const rebateDustBody = extractFunctionBody(v10Source, "_settleRebateDustIfAvailable");
assert.match(rebateDustBody, /uint256 resolutionData\s*=\s*ep\.resolutionData/);
assert.doesNotMatch(rebateDustBody, /_(?:isResolved|resolvedAt)\(ep/);
assert.match(rebateDustBody, /epochRebateClaimed\[epoch\]\s*=\s*rebatePool/);
assert.match(
  extractFunctionBody(v10Source, "settleEpochRebateDust"),
  /if\s*\(\s*dust\s*==\s*0\s*\)\s*revert\s+NothingToClaim\(\)/,
  "single rebate dust settlement must require a positive expired rebate remainder",
);
const rewardDustAlreadySettledIndex = rewardDustBody.indexOf("resolutionData & REWARD_DUST_SETTLED_FLAG");
const rewardDustCloseIndex = rewardDustBody.indexOf("ep.resolutionData = resolutionData | REWARD_DUST_SETTLED_FLAG");
assert.notEqual(rewardDustAlreadySettledIndex, -1, "reward dust helper must skip already settled epochs");
assert.notEqual(rewardDustCloseIndex, -1, "reward dust helper must close settled epochs");
assert.ok(
  rewardDustAlreadySettledIndex < rewardDustCloseIndex,
  "reward dust helper must skip duplicates before closing state again",
);
const rebateDustAlreadySettledIndex = rebateDustBody.indexOf("if (claimed >= rebatePool) return 0");
const rebateDustCloseIndex = rebateDustBody.indexOf("epochRebateClaimed[epoch] = rebatePool");
assert.notEqual(rebateDustAlreadySettledIndex, -1, "rebate dust helper must skip already exhausted epochs");
assert.notEqual(rebateDustCloseIndex, -1, "rebate dust helper must close rebate dust liability");
assert.ok(
  rebateDustAlreadySettledIndex < rebateDustCloseIndex,
  "rebate dust helper must skip duplicate batch entries before closing state again",
);
for (const [name, helperBody, closure] of [
  ["_settleRewardDustIfAvailable", rewardDustBody, "ep.resolutionData = resolutionData | REWARD_DUST_SETTLED_FLAG"],
  ["_settleRebateDustIfAvailable", rebateDustBody, "epochRebateClaimed[epoch] = rebatePool"],
]) {
  assert.ok(
    helperBody.indexOf(closure) < helperBody.indexOf("emit "),
    `${name} must close settled state before emitting settlement evidence`,
  );
}
for (const [name, countedCondition, aggregateEvent] of [
  ["settleEpochsDust", "if (settled)", "emit RewardDustBatchSettled"],
  ["settleEpochsRebateDust", "if (dust > 0)", "emit RebateDustBatchSettled"],
]) {
  const body = extractFunctionBody(v10Source, name);
  const countedConditionIndex = body.indexOf(countedCondition);
  const countedIncrementIndex = body.indexOf("epochsSettled += 1");
  const transferIndex = body.indexOf("token.safeTransfer(feeRecipient, totalDust)");
  const aggregateEventIndex = body.indexOf(aggregateEvent);
  assert.notEqual(countedConditionIndex, -1, `${name} must keep explicit newly-settled counting condition`);
  assert.notEqual(countedIncrementIndex, -1, `${name} must count newly settled epochs`);
  assert.notEqual(transferIndex, -1, `${name} aggregate dust transfer is missing`);
  assert.notEqual(aggregateEventIndex, -1, `${name} aggregate event is missing`);
  assert.ok(
    countedConditionIndex < countedIncrementIndex,
    `${name} must increment epochsSettled only from helper-confirmed newly settled entries`,
  );
  assert.ok(
    transferIndex < aggregateEventIndex,
    `${name} aggregate settlement event must follow the aggregate token transfer path`,
  );
}

const claimDeadlinePattern = /block\.timestamp\s*>=\s*resolvedAt\s*\+\s*DUST_SETTLE_DELAY/;
const settlementDeadlinePattern = /block\.timestamp\s*<\s*resolvedAt\s*\+\s*DUST_SETTLE_DELAY/;
assert.match(
  v10Source,
  /uint256\s+public\s+constant\s+DUST_SETTLE_DELAY\s*=\s*365 days\s*;/,
  "reward/rebate claim windows must remain exactly one year before dust settlement can begin",
);
assert.match(claimRewardBody, claimDeadlinePattern);
assert.match(claimRewardsBody, claimDeadlinePattern);
assert.match(extractFunctionBody(v10Source, "_previewRebateFromData"), claimDeadlinePattern);
assert.match(rewardDustBody, settlementDeadlinePattern);
assert.match(rebateDustBody, settlementDeadlinePattern);

const dustSettleDelay = 365n * 24n * 60n * 60n;
assert.equal(dustSettleDelay, 31_536_000n, "one-year dust delay must stay at 365 days in seconds");
const claimWindowResolvedAt = 2_000_000_000n;
const claimWindowDeadline = claimWindowResolvedAt + dustSettleDelay;
const dustClaimWindowBoundaryCases = [
  [claimWindowDeadline - 1n, true, false],
  [claimWindowDeadline, false, true],
  [claimWindowDeadline + 1n, false, true],
];
for (const [timestamp, claimOpen, settlementReady] of dustClaimWindowBoundaryCases) {
  assert.equal(timestamp < claimWindowDeadline, claimOpen, "reward and rebate claim windows must share the exact deadline");
  assert.equal(timestamp >= claimWindowDeadline, settlementReady, "dust settlement must start exactly when claims close");
}
const claimDustTransitionBoundaryCases = [
  ["single reward claim", claimWindowDeadline - 1n, true, false],
  ["single reward claim", claimWindowDeadline, false, true],
  ["single reward claim", claimWindowDeadline + 1n, false, true],
  ["batch reward claim", claimWindowDeadline - 1n, true, false],
  ["batch reward claim", claimWindowDeadline, false, true],
  ["batch reward claim", claimWindowDeadline + 1n, false, true],
  ["single rebate claim", claimWindowDeadline - 1n, true, false],
  ["single rebate claim", claimWindowDeadline, false, true],
  ["single rebate claim", claimWindowDeadline + 1n, false, true],
  ["batch rebate claim", claimWindowDeadline - 1n, true, false],
  ["batch rebate claim", claimWindowDeadline, false, true],
  ["batch rebate claim", claimWindowDeadline + 1n, false, true],
];
for (const [action, timestamp, expectedClaimAllowed, expectedDustAllowed] of claimDustTransitionBoundaryCases) {
  const claimAllowed = timestamp < claimWindowDeadline;
  const dustAllowed = timestamp >= claimWindowDeadline;
  assert.equal(claimAllowed, expectedClaimAllowed, `${action} deadline transition changed`);
  assert.equal(dustAllowed, expectedDustAllowed, `${action} dust transition changed`);
  assert.notEqual(claimAllowed, dustAllowed, `${action} must not overlap claim and dust windows at the boundary`);
}
const repeatedRebateDustBoundaryCases = [[0n, 0n], [1n, 0n], [100n, 40n], [100n, 100n]];
for (const [pool, alreadyClaimed] of repeatedRebateDustBoundaryCases) {
  const firstDust = pool > alreadyClaimed ? pool - alreadyClaimed : 0n;
  const closedClaimed = firstDust > 0n ? pool : alreadyClaimed;
  const repeatedDust = pool > closedClaimed ? pool - closedClaimed : 0n;
  assert.equal(repeatedDust, 0n, "rebate dust settlement must close the pool before a repeated call");
}

const maxMask = 0x1ffffff;
const masks = [0, 1, maxMask, 0x1555555, 0x1001001];
for (let bit = 0; bit < 25; bit += 1) masks.push(1 << bit);
for (let left = 0; left < 25; left += 1) {
  for (let right = left + 1; right < 25; right += 1) masks.push((1 << left) | (1 << right));
}
let random = 0x6d2b79f5;
for (let index = 0; index < 25_000; index += 1) {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  masks.push(random & maxMask);
}
for (const mask of masks) {
  assert.equal(swarPopcount(mask), jsPopcount(mask), `bitmap popcount mismatch for ${mask}`);
}

function packClock(duration, epoch, startTime) {
  return duration | (epoch << 32n) | (startTime << 128n);
}
const packedClockCases = [
  [60n, 1n, 1n],
  [3_600n, 1_000_000_000_000n, 2_000_000_000n],
  [(1n << 32n) - 1n, (1n << 96n) - 1n, (1n << 128n) - 1n],
];
for (const [duration, epoch, startTime] of packedClockCases) {
  const packed = packClock(duration, epoch, startTime);
  assert.equal(packed & ((1n << 32n) - 1n), duration);
  assert.equal((packed >> 32n) & ((1n << 96n) - 1n), epoch);
  assert.equal(packed >> 128n, startTime);
}

const maxPackedTimestamp = (1n << 128n) - 1n;
const packedJackpotTimestampCases = [
  [0n, 0n],
  [1n, 2n],
  [2_000_000_000n, 2_000_000_001n],
  [maxPackedTimestamp, maxPackedTimestamp],
];
for (const [dailyCheck, weeklyCheck] of packedJackpotTimestampCases) {
  const packed = dailyCheck | (weeklyCheck << 128n);
  assert.equal(packed & maxPackedTimestamp, dailyCheck, "daily jackpot check timestamp must round-trip");
  assert.equal(packed >> 128n, weeklyCheck, "weekly jackpot check timestamp must round-trip");
}

const resolutionTimestampMask = (1n << 128n) - 1n;
const resolutionWinningTileMask = (1n << 8n) - 1n;
const dailyFlag = 1n << 136n;
const weeklyFlag = 1n << 137n;
const rewardDustFlag = 1n << 138n;
const packedResolutionTimestampCases = [1n, 2_000_000_000n, resolutionTimestampMask];
const packedResolutionWinningTileCases = [1n, 25n, resolutionWinningTileMask];
const packedResolutionFlagCases = [
  0n,
  dailyFlag,
  weeklyFlag,
  dailyFlag | weeklyFlag,
  rewardDustFlag,
  dailyFlag | weeklyFlag | rewardDustFlag,
];
for (const resolvedAt of packedResolutionTimestampCases) {
  for (const winningTile of packedResolutionWinningTileCases) {
    for (const flags of packedResolutionFlagCases) {
      const packed = resolvedAt | (winningTile << 128n) | flags;
      assert.equal(packed & resolutionTimestampMask, resolvedAt);
      assert.equal((packed >> 128n) & resolutionWinningTileMask, winningTile);
      assert.equal(packed & (dailyFlag | weeklyFlag | rewardDustFlag), flags);
      assert.notEqual(packed, 0n, "resolved metadata must remain a valid resolution sentinel");
    }
  }
}
assert.match(extractFunctionBody(v10Source, "_storeEpochClock"), /type\(uint32\)\.max/);
assert.match(extractFunctionBody(v10Source, "_storeEpochClock"), /type\(uint96\)\.max/);
assert.match(extractFunctionBody(v10Source, "_storeEpochClock"), /type\(uint128\)\.max/);
assert.match(extractFunctionBody(v10Source, "_packResolutionData"), /type\(uint128\)\.max/);
assert.match(extractFunctionBody(v10Source, "_packResolutionData"), /type\(uint8\)\.max/);

const MAX_UINT256 = (1n << 256n) - 1n;
const FULL_RANGE_ACCOUNTING_CASES = 20_000;
const FULL_RANGE_PROPORTIONAL_CASES = 20_000;
let arithmeticState = 0x6c6f72652d7631302d66756c6c2d72616e6765n;
function nextUint256() {
  arithmeticState ^= arithmeticState << 13n;
  arithmeticState ^= arithmeticState >> 7n;
  arithmeticState ^= arithmeticState << 17n;
  arithmeticState &= MAX_UINT256;
  return arithmeticState;
}
const mulDiv = (x, y, denominator) => (x * y) / denominator;
function previewCappedRebate({ rebatePool, claimedTotal, totalPool, winningPool, userVolume }) {
  if (totalPool === 0n || rebatePool === 0n || claimedTotal >= rebatePool) return 0n;
  if (winningPool >= totalPool) return 0n;
  const losingVolume = totalPool - winningPool;
  const amount = mulDiv(rebatePool, userVolume, losingVolume);
  const remaining = rebatePool - claimedTotal;
  return amount > remaining ? remaining : amount;
}
function assertAccountingConservation(freshPool, rolloverPool) {
  const totalPool = freshPool + rolloverPool;
  const dailyAccrual = mulDiv(freshPool, 2n, 100n);
  const weeklyAccrual = mulDiv(freshPool, 3n, 100n);
  const protocolFee = mulDiv(freshPool, 2n, 100n);
  const burnFee = mulDiv(freshPool, 1n, 100n);
  const resolverReward = mulDiv(freshPool, 5n, 10_000n);
  const netProtocolFee = protocolFee - resolverReward;
  const rebatePool = netProtocolFee / 2n;
  const ownerFee = netProtocolFee - rebatePool;
  const rewardPool = totalPool - dailyAccrual - weeklyAccrual - protocolFee - burnFee;
  assert.equal(
    rewardPool + dailyAccrual + weeklyAccrual + burnFee + resolverReward + rebatePool + ownerFee,
    totalPool,
    "full-range fee split must conserve every liability",
  );
  assert.ok(rewardPool >= rolloverPool, "rollover must never be charged a second fee");
  return {
    dailyAccrual,
    weeklyAccrual,
    protocolFee,
    burnFee,
    resolverReward,
    rebatePool,
    ownerFee,
    rewardPool,
  };
}

function simulateProtocolFeeFlush({ ownerFees, burnFees, failOwnerTransfer = false, failBurnTransfer = false }) {
  const before = { ownerFees, burnFees };
  const transfers = [];
  try {
    if (ownerFees > 0n) {
      ownerFees = 0n;
      if (failOwnerTransfer) throw new Error("owner-transfer-reverted");
      transfers.push({ to: "feeRecipient", amount: before.ownerFees });
    }
    if (burnFees > 0n) {
      burnFees = 0n;
      if (failBurnTransfer) throw new Error("burn-transfer-reverted");
      transfers.push({ to: "burn", amount: before.burnFees });
    }
    return {
      reverted: false,
      ownerFees,
      burnFees,
      transfers,
      event: { ownerAmount: before.ownerFees, burnAmount: before.burnFees },
    };
  } catch (error) {
    return {
      reverted: true,
      reason: error instanceof Error ? error.message : String(error),
      ownerFees: before.ownerFees,
      burnFees: before.burnFees,
      transfers: [],
      event: null,
    };
  }
}

function simulateProtocolFeeFlushEntrypoint(params) {
  if (params.ownerFees === 0n && params.burnFees === 0n) {
    return {
      reverted: true,
      reason: "nothing-to-flush",
      ownerFees: 0n,
      burnFees: 0n,
      transfers: [],
      event: null,
    };
  }
  return simulateProtocolFeeFlush(params);
}

assertAccountingConservation(0n, MAX_UINT256);
assertAccountingConservation(MAX_UINT256, 0n);
assert.deepEqual(
  assertAccountingConservation(100n * 10n ** 18n, 0n),
  {
    dailyAccrual: 2n * 10n ** 18n,
    weeklyAccrual: 3n * 10n ** 18n,
    protocolFee: 2n * 10n ** 18n,
    burnFee: 1n * 10n ** 18n,
    resolverReward: 50_000_000_000_000_000n,
    rebatePool: 975_000_000_000_000_000n,
    ownerFee: 975_000_000_000_000_000n,
    rewardPool: 92n * 10n ** 18n,
  },
  "100-token economic ledger must match the approved fee, jackpot, and Safety Pool split",
);
const protocolFeeFlushModelCases = [
  { ownerFees: 0n, burnFees: 0n },
  { ownerFees: 1n, burnFees: 0n },
  { ownerFees: 0n, burnFees: 1n },
  { ownerFees: 13n, burnFees: 17n },
  { ownerFees: MAX_UINT256, burnFees: 0n },
  { ownerFees: 0n, burnFees: MAX_UINT256 },
  { ownerFees: MAX_UINT256, burnFees: MAX_UINT256 },
];
const flushProtocolFeesBody = extractFunctionBody(v10Source, "flushProtocolFees").replace(/\s+/g, " ");
const flushZeroGuardIndex = flushProtocolFeesBody.indexOf("if (accruedOwnerFees == 0 && accruedBurnFees == 0) revert NothingToFlush()");
const flushApplyPendingFeeRecipientIndex = flushProtocolFeesBody.indexOf("_applyPendingFeeRecipientIfReady()");
const flushInternalCallIndex = flushProtocolFeesBody.indexOf("_flushProtocolFees()");
assert.notEqual(flushZeroGuardIndex, -1, "external protocol fee flush zero-liability guard changed");
assert.notEqual(flushApplyPendingFeeRecipientIndex, -1, "external protocol fee flush fee-recipient update changed");
assert.notEqual(flushInternalCallIndex, -1, "external protocol fee flush internal call changed");
assert.ok(
  flushZeroGuardIndex < flushApplyPendingFeeRecipientIndex && flushApplyPendingFeeRecipientIndex < flushInternalCallIndex,
  "external protocol fee flush must reject zero liabilities before fee-recipient updates and internal transfers",
);
const protocolFeeFlushEntrypointCases = [
  { ownerFees: 0n, burnFees: 0n, expectedReverted: true, expectedTransfers: 0 },
  { ownerFees: 1n, burnFees: 0n, expectedReverted: false, expectedTransfers: 1 },
  { ownerFees: 0n, burnFees: 1n, expectedReverted: false, expectedTransfers: 1 },
  { ownerFees: 13n, burnFees: 17n, expectedReverted: false, expectedTransfers: 2 },
];
for (const modelCase of protocolFeeFlushEntrypointCases) {
  const result = simulateProtocolFeeFlushEntrypoint(modelCase);
  assert.equal(result.reverted, modelCase.expectedReverted, "external protocol fee flush entrypoint guard changed");
  assert.equal(result.transfers.length, modelCase.expectedTransfers, "external protocol fee flush transfer count changed");
  if (modelCase.expectedReverted) {
    assert.equal(result.reason, "nothing-to-flush", "zero-liability protocol fee flush must fail closed");
    assert.equal(result.event, null, "zero-liability protocol fee flush must not emit flushed evidence");
  }
}
for (const modelCase of protocolFeeFlushModelCases) {
  const success = simulateProtocolFeeFlush(modelCase);
  assert.equal(success.reverted, false, "successful protocol fee flush model must not revert");
  assert.equal(success.ownerFees, 0n, "successful protocol fee flush must close owner liability");
  assert.equal(success.burnFees, 0n, "successful protocol fee flush must close burn liability");
  assert.deepEqual(
    success.transfers.map((transfer) => transfer.amount),
    [modelCase.ownerFees, modelCase.burnFees].filter((amount) => amount > 0n),
    "successful protocol fee flush must transfer exactly each positive liability",
  );
  assert.deepEqual(
    success.event,
    { ownerAmount: modelCase.ownerFees, burnAmount: modelCase.burnFees },
    "protocol fee flush event must report the pre-close liabilities",
  );

  if (modelCase.ownerFees > 0n) {
    const ownerFailure = simulateProtocolFeeFlush({ ...modelCase, failOwnerTransfer: true });
    assert.equal(ownerFailure.reverted, true, "owner transfer failure must revert the protocol fee flush");
    assert.equal(ownerFailure.ownerFees, modelCase.ownerFees, "owner transfer failure must preserve owner liability");
    assert.equal(ownerFailure.burnFees, modelCase.burnFees, "owner transfer failure must preserve burn liability");
    assert.deepEqual(ownerFailure.transfers, [], "reverted protocol fee flush must not retain transfer evidence");
    assert.equal(ownerFailure.event, null, "reverted protocol fee flush must not emit flushed evidence");
  }
  if (modelCase.burnFees > 0n) {
    const burnFailure = simulateProtocolFeeFlush({ ...modelCase, failBurnTransfer: true });
    assert.equal(burnFailure.reverted, true, "burn transfer failure must revert the protocol fee flush");
    assert.equal(burnFailure.ownerFees, modelCase.ownerFees, "burn transfer failure must restore owner liability");
    assert.equal(burnFailure.burnFees, modelCase.burnFees, "burn transfer failure must preserve burn liability");
    assert.deepEqual(burnFailure.transfers, [], "reverted protocol fee flush must not retain partial transfer evidence");
    assert.equal(burnFailure.event, null, "reverted protocol fee flush must not emit flushed evidence");
  }
}

function simulateClaimBatch({ epochs, amounts, alreadyClaimed = [] }) {
  const claimed = new Set(alreadyClaimed);
  let total = 0n;
  let count = 0;
  const perEpochEvents = [];
  for (const epoch of epochs) {
    const amount = amounts.get(epoch) ?? 0n;
    if (!claimed.has(epoch) && amount > 0n) {
      claimed.add(epoch);
      total += amount;
      count += 1;
      perEpochEvents.push({ epoch, amount });
    }
  }
  return {
    reverted: total === 0n,
    total,
    count,
    perEpochEvents,
    claimed,
    claimedSize: claimed.size,
  };
}

function simulateClaimTransferExit({
  amount,
  alreadyClaimed = false,
  aggregateClaimedBefore = 0n,
  failTransfer = false,
}) {
  const before = { claimed: alreadyClaimed, aggregateClaimed: aggregateClaimedBefore };
  let claimed = alreadyClaimed;
  let aggregateClaimed = aggregateClaimedBefore;
  const transfers = [];
  const events = [];
  try {
    if (claimed || amount === 0n) {
      throw new Error("nothing-to-claim");
    }
    claimed = true;
    aggregateClaimed += amount;
    if (failTransfer) {
      throw new Error("claim-transfer-reverted");
    }
    transfers.push({ to: "claimant", amount });
    events.push({ amount });
    return { reverted: false, claimed, aggregateClaimed, transfers, events };
  } catch (error) {
    return {
      reverted: true,
      reason: error instanceof Error ? error.message : String(error),
      claimed: before.claimed,
      aggregateClaimed: before.aggregateClaimed,
      transfers: [],
      events: [],
    };
  }
}

function simulateBatchClaimTransferExit({ entries, alreadyClaimed = [], aggregateClaimedBefore = 0n, failTransfer = false }) {
  const before = {
    claimed: new Set(alreadyClaimed),
    aggregateClaimed: aggregateClaimedBefore,
  };
  const claimed = new Set(before.claimed);
  let aggregateClaimed = aggregateClaimedBefore;
  let total = 0n;
  const perEpochEvents = [];
  const transfers = [];
  const aggregateEvents = [];
  try {
    for (const { epoch, amount } of entries) {
      if (claimed.has(epoch) || amount === 0n) continue;
      claimed.add(epoch);
      aggregateClaimed += amount;
      total += amount;
      perEpochEvents.push({ epoch, amount });
    }
    if (total === 0n) {
      throw new Error("nothing-to-claim");
    }
    if (failTransfer) {
      throw new Error("batch-claim-transfer-reverted");
    }
    transfers.push({ to: "claimant", amount: total });
    aggregateEvents.push({ amount: total, count: perEpochEvents.length });
    return {
      reverted: false,
      claimed,
      claimedSize: claimed.size,
      aggregateClaimed,
      total,
      perEpochEvents,
      transfers,
      aggregateEvents,
    };
  } catch (error) {
    return {
      reverted: true,
      reason: error instanceof Error ? error.message : String(error),
      claimed: before.claimed,
      claimedSize: before.claimed.size,
      aggregateClaimed: before.aggregateClaimed,
      total: 0n,
      perEpochEvents: [],
      transfers: [],
      aggregateEvents: [],
    };
  }
}

function simulateRewardDustBatch({ epochs, dustByEpoch, alreadySettled = [] }) {
  const settled = new Set(alreadySettled);
  let totalDust = 0n;
  let epochsSettled = 0;
  const perEpochEvents = [];
  for (const epoch of epochs) {
    if (settled.has(epoch)) continue;
    settled.add(epoch);
    const dust = dustByEpoch.get(epoch) ?? 0n;
    totalDust += dust;
    epochsSettled += 1;
    perEpochEvents.push({ epoch, dust });
  }
  return {
    reverted: epochsSettled === 0,
    totalDust,
    epochsSettled,
    perEpochEvents,
    settled,
    settledSize: settled.size,
  };
}

function simulateRebateDustBatch({ epochs, pools, claimed }) {
  const nextClaimed = new Map(claimed);
  let totalDust = 0n;
  let epochsSettled = 0;
  const perEpochEvents = [];
  for (const epoch of epochs) {
    const pool = pools.get(epoch) ?? 0n;
    const alreadyClaimed = nextClaimed.get(epoch) ?? 0n;
    if (alreadyClaimed >= pool) continue;
    const dust = pool - alreadyClaimed;
    nextClaimed.set(epoch, pool);
    totalDust += dust;
    epochsSettled += 1;
    perEpochEvents.push({ epoch, dust });
  }
  return {
    reverted: totalDust === 0n,
    totalDust,
    epochsSettled,
    perEpochEvents,
    claimed: nextClaimed,
  };
}

function simulateDustBatchTransferExit({ entries, alreadyClosed = [], closeZeroDust = false, failTransfer = false }) {
  const beforeClosed = new Set(alreadyClosed);
  const closed = new Set(beforeClosed);
  let totalDust = 0n;
  const perEpochEvents = [];
  const transfers = [];
  const aggregateEvents = [];
  try {
    for (const { epoch, dust } of entries) {
      if (closed.has(epoch)) continue;
      if (dust === 0n && !closeZeroDust) continue;
      closed.add(epoch);
      totalDust += dust;
      perEpochEvents.push({ epoch, dust });
    }
    if (perEpochEvents.length === 0 || (!closeZeroDust && totalDust === 0n)) {
      throw new Error("nothing-to-settle");
    }
    if (failTransfer && totalDust > 0n) {
      throw new Error("dust-transfer-reverted");
    }
    if (totalDust > 0n) {
      transfers.push({ to: "feeRecipient", amount: totalDust });
    }
    aggregateEvents.push({ amount: totalDust, count: perEpochEvents.length });
    return {
      reverted: false,
      closed,
      closedSize: closed.size,
      totalDust,
      perEpochEvents,
      transfers,
      aggregateEvents,
    };
  } catch (error) {
    return {
      reverted: true,
      reason: error instanceof Error ? error.message : String(error),
      closed: beforeClosed,
      closedSize: beforeClosed.size,
      totalDust: 0n,
      perEpochEvents: [],
      transfers: [],
      aggregateEvents: [],
    };
  }
}

const duplicateBatchModelCases = [
  {
    name: "reward duplicate entries",
    run: () => simulateClaimBatch({
      epochs: [11, 11, 12, 11, 13, 12],
      amounts: new Map([[11, 3n], [12, 5n], [13, 0n]]),
    }),
    expected: { reverted: false, total: 8n, count: 2, events: 2 },
  },
  {
    name: "rebate duplicate entries",
    run: () => simulateClaimBatch({
      epochs: [21, 22, 21, 23, 22],
      amounts: new Map([[21, 7n], [22, 0n], [23, 2n]]),
    }),
    expected: { reverted: false, total: 9n, count: 2, events: 2 },
  },
  {
    name: "reward replayed preclaimed entry",
    run: () => simulateClaimBatch({
      epochs: [14, 15, 14, 16, 15],
      amounts: new Map([[14, 9n], [15, 4n], [16, 0n]]),
      alreadyClaimed: [14],
    }),
    expected: { reverted: false, total: 4n, count: 1, events: 1, claimedSize: 2 },
  },
  {
    name: "rebate replayed preclaimed entries revert when nothing remains payable",
    run: () => simulateClaimBatch({
      epochs: [24, 24, 25],
      amounts: new Map([[24, 7n], [25, 0n]]),
      alreadyClaimed: [24],
    }),
    expected: { reverted: true, total: 0n, count: 0, events: 0, claimedSize: 1 },
  },
  {
    name: "reward all-nonpayable duplicate entries revert without closing epochs",
    run: () => simulateClaimBatch({
      epochs: [26, 26, 27, 28, 27],
      amounts: new Map([[26, 0n], [28, 0n]]),
    }),
    expected: { reverted: true, total: 0n, count: 0, events: 0, claimedSize: 0 },
  },
  {
    name: "rebate all-nonpayable duplicate entries revert without closing epochs",
    run: () => simulateClaimBatch({
      epochs: [29, 30, 29, 30],
      amounts: new Map([[29, 0n], [30, 0n]]),
    }),
    expected: { reverted: true, total: 0n, count: 0, events: 0, claimedSize: 0 },
  },
  {
    name: "reward dust duplicate entries with zero dust closure",
    run: () => simulateRewardDustBatch({
      epochs: [31, 31, 32, 31],
      dustByEpoch: new Map([[31, 0n], [32, 4n]]),
    }),
    expected: { reverted: false, totalDust: 4n, epochsSettled: 2, events: 2 },
  },
  {
    name: "reward dust all-pre-settled duplicate entries revert without events",
    run: () => simulateRewardDustBatch({
      epochs: [33, 33, 34, 33, 34],
      dustByEpoch: new Map([[33, 5n], [34, 0n]]),
      alreadySettled: [33, 34],
    }),
    expected: { reverted: true, totalDust: 0n, epochsSettled: 0, events: 0, settledSize: 2 },
  },
  {
    name: "rebate dust duplicate entries",
    run: () => simulateRebateDustBatch({
      epochs: [41, 41, 42, 42],
      pools: new Map([[41, 10n], [42, 12n]]),
      claimed: new Map([[41, 4n], [42, 12n]]),
    }),
    expected: { reverted: false, totalDust: 6n, epochsSettled: 1, events: 1 },
  },
  {
    name: "rebate dust all-closed duplicate entries revert without events",
    run: () => simulateRebateDustBatch({
      epochs: [43, 43, 44, 45, 44],
      pools: new Map([[43, 10n], [44, 0n], [45, 3n]]),
      claimed: new Map([[43, 10n], [44, 0n], [45, 3n]]),
    }),
    expected: { reverted: true, totalDust: 0n, epochsSettled: 0, events: 0 },
  },
];
for (const modelCase of duplicateBatchModelCases) {
  const result = modelCase.run();
  const { events, ...expected } = modelCase.expected;
  assert.deepEqual(
    Object.fromEntries(Object.keys(expected).map((key) => [key, result[key]])),
    expected,
    `${modelCase.name} aggregate result changed`,
  );
  assert.equal(result.perEpochEvents.length, events, `${modelCase.name} must emit only once per newly closed eligible entry`);
}
const resolverClaimReplay = simulateClaimBatch({
  epochs: [0, 0],
  amounts: new Map([[0, 19n]]),
});
assert.equal(resolverClaimReplay.total, 19n, "resolver reward replay model must not transfer the same pending amount twice");
assert.equal(resolverClaimReplay.count, 1, "resolver reward replay model must close pending amount before a repeated claim");
const tokenTransferRollbackCases = [
  {
    name: "single reward claim success",
    run: () => simulateClaimTransferExit({ amount: 7n }),
    expected: { reverted: false, claimed: true, aggregateClaimed: 7n, transfers: 1, events: 1 },
  },
  {
    name: "single reward claim token-transfer failure",
    run: () => simulateClaimTransferExit({ amount: 7n, failTransfer: true }),
    expected: { reverted: true, reason: "claim-transfer-reverted", claimed: false, aggregateClaimed: 0n, transfers: 0, events: 0 },
  },
  {
    name: "single rebate claim token-transfer failure",
    run: () => simulateClaimTransferExit({ amount: 5n, aggregateClaimedBefore: 3n, failTransfer: true }),
    expected: { reverted: true, reason: "claim-transfer-reverted", claimed: false, aggregateClaimed: 3n, transfers: 0, events: 0 },
  },
  {
    name: "already claimed replay",
    run: () => simulateClaimTransferExit({ amount: 11n, alreadyClaimed: true, aggregateClaimedBefore: 11n }),
    expected: { reverted: true, reason: "nothing-to-claim", claimed: true, aggregateClaimed: 11n, transfers: 0, events: 0 },
  },
];
for (const modelCase of tokenTransferRollbackCases) {
  const result = modelCase.run();
  const expected = modelCase.expected;
  assert.equal(result.reverted, expected.reverted, `${modelCase.name} revert status changed`);
  if (expected.reason) assert.equal(result.reason, expected.reason, `${modelCase.name} revert reason changed`);
  assert.equal(result.claimed, expected.claimed, `${modelCase.name} claimed state changed`);
  assert.equal(result.aggregateClaimed, expected.aggregateClaimed, `${modelCase.name} aggregate liability changed`);
  assert.equal(result.transfers.length, expected.transfers, `${modelCase.name} transfer evidence changed`);
  assert.equal(result.events.length, expected.events, `${modelCase.name} event evidence changed`);
}
const batchTransferRollbackCases = [
  {
    name: "batch reward claim success",
    run: () => simulateBatchClaimTransferExit({
      entries: [{ epoch: 101, amount: 3n }, { epoch: 102, amount: 0n }, { epoch: 103, amount: 5n }],
    }),
    expected: { reverted: false, claimedSize: 2, aggregateClaimed: 8n, total: 8n, perEpochEvents: 2, transfers: 1, aggregateEvents: 1 },
  },
  {
    name: "batch reward aggregate transfer failure",
    run: () => simulateBatchClaimTransferExit({
      entries: [{ epoch: 111, amount: 3n }, { epoch: 112, amount: 5n }],
      failTransfer: true,
    }),
    expected: {
      reverted: true,
      reason: "batch-claim-transfer-reverted",
      claimedSize: 0,
      aggregateClaimed: 0n,
      total: 0n,
      perEpochEvents: 0,
      transfers: 0,
      aggregateEvents: 0,
    },
  },
  {
    name: "batch reward duplicate entries rollback on aggregate transfer failure",
    run: () => simulateBatchClaimTransferExit({
      entries: [{ epoch: 113, amount: 3n }, { epoch: 113, amount: 3n }, { epoch: 114, amount: 5n }],
      failTransfer: true,
    }),
    expected: {
      reverted: true,
      reason: "batch-claim-transfer-reverted",
      claimedSize: 0,
      aggregateClaimed: 0n,
      total: 0n,
      perEpochEvents: 0,
      transfers: 0,
      aggregateEvents: 0,
    },
  },
  {
    name: "batch rebate aggregate transfer failure with preclaimed skip",
    run: () => simulateBatchClaimTransferExit({
      entries: [{ epoch: 121, amount: 7n }, { epoch: 122, amount: 11n }, { epoch: 121, amount: 7n }],
      alreadyClaimed: [122],
      aggregateClaimedBefore: 11n,
      failTransfer: true,
    }),
    expected: {
      reverted: true,
      reason: "batch-claim-transfer-reverted",
      claimedSize: 1,
      aggregateClaimed: 11n,
      total: 0n,
      perEpochEvents: 0,
      transfers: 0,
      aggregateEvents: 0,
    },
  },
  {
    name: "batch all-nonpayable entries",
    run: () => simulateBatchClaimTransferExit({
      entries: [{ epoch: 131, amount: 0n }, { epoch: 132, amount: 0n }, { epoch: 131, amount: 0n }],
    }),
    expected: { reverted: true, reason: "nothing-to-claim", claimedSize: 0, aggregateClaimed: 0n, total: 0n, perEpochEvents: 0, transfers: 0, aggregateEvents: 0 },
  },
];
for (const modelCase of batchTransferRollbackCases) {
  const result = modelCase.run();
  const expected = modelCase.expected;
  assert.equal(result.reverted, expected.reverted, `${modelCase.name} revert status changed`);
  if (expected.reason) assert.equal(result.reason, expected.reason, `${modelCase.name} revert reason changed`);
  assert.equal(result.claimedSize, expected.claimedSize, `${modelCase.name} claimed set size changed`);
  assert.equal(result.aggregateClaimed, expected.aggregateClaimed, `${modelCase.name} aggregate liability changed`);
  assert.equal(result.total, expected.total, `${modelCase.name} total changed`);
  assert.equal(result.perEpochEvents.length, expected.perEpochEvents, `${modelCase.name} per-epoch event evidence changed`);
  assert.equal(result.transfers.length, expected.transfers, `${modelCase.name} transfer evidence changed`);
  assert.equal(result.aggregateEvents.length, expected.aggregateEvents, `${modelCase.name} aggregate event evidence changed`);
}
const dustTransferRollbackCases = [
  {
    name: "reward dust aggregate success",
    run: () => simulateDustBatchTransferExit({
      entries: [{ epoch: 201, dust: 0n }, { epoch: 202, dust: 9n }],
      closeZeroDust: true,
    }),
    expected: { reverted: false, closedSize: 2, totalDust: 9n, perEpochEvents: 2, transfers: 1, aggregateEvents: 1 },
  },
  {
    name: "reward dust aggregate transfer failure",
    run: () => simulateDustBatchTransferExit({
      entries: [{ epoch: 211, dust: 0n }, { epoch: 212, dust: 9n }],
      closeZeroDust: true,
      failTransfer: true,
    }),
    expected: { reverted: true, reason: "dust-transfer-reverted", closedSize: 0, totalDust: 0n, perEpochEvents: 0, transfers: 0, aggregateEvents: 0 },
  },
  {
    name: "reward dust zero-only closure success",
    run: () => simulateDustBatchTransferExit({
      entries: [{ epoch: 221, dust: 0n }, { epoch: 222, dust: 0n }],
      closeZeroDust: true,
    }),
    expected: { reverted: false, closedSize: 2, totalDust: 0n, perEpochEvents: 2, transfers: 0, aggregateEvents: 1 },
  },
  {
    name: "rebate dust aggregate transfer failure with preclosed skip",
    run: () => simulateDustBatchTransferExit({
      entries: [{ epoch: 231, dust: 7n }, { epoch: 232, dust: 11n }, { epoch: 231, dust: 7n }],
      alreadyClosed: [232],
      failTransfer: true,
    }),
    expected: { reverted: true, reason: "dust-transfer-reverted", closedSize: 1, totalDust: 0n, perEpochEvents: 0, transfers: 0, aggregateEvents: 0 },
  },
  {
    name: "rebate dust all-closed entries",
    run: () => simulateDustBatchTransferExit({
      entries: [{ epoch: 241, dust: 7n }, { epoch: 242, dust: 0n }],
      alreadyClosed: [241],
    }),
    expected: { reverted: true, reason: "nothing-to-settle", closedSize: 1, totalDust: 0n, perEpochEvents: 0, transfers: 0, aggregateEvents: 0 },
  },
];
for (const modelCase of dustTransferRollbackCases) {
  const result = modelCase.run();
  const expected = modelCase.expected;
  assert.equal(result.reverted, expected.reverted, `${modelCase.name} revert status changed`);
  if (expected.reason) assert.equal(result.reason, expected.reason, `${modelCase.name} revert reason changed`);
  assert.equal(result.closedSize, expected.closedSize, `${modelCase.name} closed state size changed`);
  assert.equal(result.totalDust, expected.totalDust, `${modelCase.name} total dust changed`);
  assert.equal(result.perEpochEvents.length, expected.perEpochEvents, `${modelCase.name} per-epoch event evidence changed`);
  assert.equal(result.transfers.length, expected.transfers, `${modelCase.name} transfer evidence changed`);
  assert.equal(result.aggregateEvents.length, expected.aggregateEvents, `${modelCase.name} aggregate event evidence changed`);
}
let safeDomainEquivalenceCases = 0;
for (let index = 0; index < FULL_RANGE_ACCOUNTING_CASES; index += 1) {
  const freshPool = nextUint256();
  const rolloverPool = nextUint256() % (MAX_UINT256 - freshPool + 1n);
  const fullPrecision = assertAccountingConservation(freshPool, rolloverPool);
  if (freshPool <= MAX_UINT256 / 5n) {
    safeDomainEquivalenceCases += 1;
    assert.equal(fullPrecision.dailyAccrual, (freshPool * 2n) / 100n);
    assert.equal(fullPrecision.weeklyAccrual, (freshPool * 3n) / 100n);
    assert.equal(fullPrecision.protocolFee, (freshPool * 2n) / 100n);
    assert.equal(fullPrecision.burnFee, freshPool / 100n);
    assert.equal(fullPrecision.resolverReward, (freshPool * 5n) / 10_000n);
  }
}
assert.ok(safeDomainEquivalenceCases > 1_000, "full-range seed must exercise the V9-safe arithmetic domain");

for (let index = 0; index < FULL_RANGE_PROPORTIONAL_CASES; index += 1) {
  const denominator = nextUint256() || 1n;
  const firstShare = nextUint256() % (denominator + 1n);
  const secondShare = denominator - firstShare;
  const pool = nextUint256();
  const firstAmount = mulDiv(pool, firstShare, denominator);
  const secondAmount = mulDiv(pool, secondShare, denominator);
  assert.ok(firstAmount <= pool, "full-range reward share must not exceed its pool");
  assert.ok(secondAmount <= pool, "full-range rebate share must not exceed its pool");
  assert.ok(firstAmount + secondAmount <= pool, "rounded proportional claims must not overdraw their pool");
}
for (let index = 0; index < FULL_RANGE_PROPORTIONAL_CASES; index += 1) {
  const losingVolume = (nextUint256() % 1_000_000_000_000n) + 1n;
  const winningPool = nextUint256() % 1_000_000_000_000n;
  const totalPool = winningPool + losingVolume;
  const rebatePool = nextUint256();
  let claimedTotal = 0n;
  let remainingVolume = losingVolume;
  for (let claimIndex = 0; claimIndex < 4; claimIndex += 1) {
    const userVolume = claimIndex === 3
      ? remainingVolume
      : nextUint256() % (remainingVolume + 1n);
    remainingVolume -= userVolume;
    const claim = previewCappedRebate({ rebatePool, claimedTotal, totalPool, winningPool, userVolume });
    assert.ok(claim <= rebatePool - claimedTotal, "sequential rebate claim must not exceed remaining liability");
    claimedTotal += claim;
    assert.ok(claimedTotal <= rebatePool, "sequential rebate claims must never overdraw the rebate pool");
  }
  assert.equal(
    previewCappedRebate({ rebatePool, claimedTotal: rebatePool, totalPool, winningPool, userVolume: losingVolume }),
    0n,
    "exhausted rebate pool must produce no further claimable amount",
  );
}

console.log(JSON.stringify({
  status: "passed",
  compilerVersion: solc.version(),
  compiler: { optimizer: true, runs: 200, viaIR: false, evmVersion: "osaka" },
  creationBytes,
  deploymentInitCodeBytes,
  initCodeHeadroomBytes: EIP_3860_INITCODE_LIMIT - deploymentInitCodeBytes,
  runtimeBytes,
  runtimeHeadroomBytes: EIP_170_RUNTIME_LIMIT - runtimeBytes,
  runtimeIdentityReferences: runtimeIdentityReferences.length,
  functionSelectors: functionSelectors.size,
  stateChangingEntrypoints: stateChangingV10Functions.length,
  guardedLocalMutationEntrypoints: guardedLocalMutationEntrypoints.length,
  documentedStateChangingEntrypoints: stateChangingV10Functions.length,
  documentedStateChangingParameters,
  locallyDeclaredEvents: locallyDeclaredV10EventKeys.length,
  frontendEvents: frontendEventNames.length,
  indexedEvents: indexerEventNames.length,
  frontendOnlyEvents: frontendOnlyEventNames.length,
  reviewedFrontendOnlyEvents: true,
  classifiedTokenInteractions: checkedTokenInteractions,
  checkedFinancialExits: financialExitClosures.size + 1,
  readOnlyBenchmarkBoundary: true,
  localGateBoundary: true,
  canonicalTokenomicsSample: true,
  preservedV9AbiItems: v9Abi.size,
  checkedBitmapMasks: masks.length,
  protocolFeeFlushModelCases: protocolFeeFlushModelCases.length,
  protocolFeeFlushEntrypointCases: protocolFeeFlushEntrypointCases.length,
  duplicateBatchModelCases: duplicateBatchModelCases.length,
  tokenTransferRollbackCases: tokenTransferRollbackCases.length,
  batchTransferRollbackCases: batchTransferRollbackCases.length,
  dustTransferRollbackCases: dustTransferRollbackCases.length,
  timelockBoundaryCases:
    feeRecipientTimelockCases.length +
    epochDurationTimelockCases.length +
    epochDurationScheduleBoundaryCases.length,
  dustBoundaryCases:
    dustClaimWindowBoundaryCases.length +
    claimDustTransitionBoundaryCases.length +
    repeatedRebateDustBoundaryCases.length,
  packedBoundaryCases:
    packedRebateRoundTripCases.length +
    packedRebateFlagCases.length * packedRebateUpdateCases.length +
    packedClockCases.length +
    packedJackpotTimestampCases.length +
    packedResolutionTimestampCases.length * packedResolutionWinningTileCases.length * packedResolutionFlagCases.length,
  fullRangeAccountingCases: FULL_RANGE_ACCOUNTING_CASES + 2,
  fullRangeProportionalCases: FULL_RANGE_PROPORTIONAL_CASES,
  safeDomainEquivalenceCases,
}, null, 2));
