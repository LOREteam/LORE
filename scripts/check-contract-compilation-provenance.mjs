import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
    abiSnapshotPath: "config/generated/lineaOreV10Abi.ts",
    abiFragmentCompilerObjects: [
      {
        sourcePath: "@openzeppelin/contracts/interfaces/draft-IERC6093.sol",
        contractName: "IERC20Errors",
      },
    ],
    compilerPackage: "solc",
    expectedCompiler: "0.8.36+commit.8a079791",
  },
};
const targetName = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length) || "v9";
const SUMMARY_ONLY = process.argv.includes("--summary-only");
const WRITE_ABI_SNAPSHOT = process.argv.includes("--write-abi-snapshot");
const SELF_TEST_IMPORT_BOUNDARY = process.argv.includes("--self-test-import-boundary");
const target = TARGETS[targetName];
if (!target) throw new Error(`Unknown compilation target: ${targetName}`);
const {
  contractPath: CONTRACT_PATH,
  contractName: CONTRACT_NAME,
  manifestPath: MANIFEST_PATH,
  compilerConfigPath: COMPILER_CONFIG_PATH,
  abiSnapshotPath: ABI_SNAPSHOT_PATH,
  abiFragmentCompilerObjects: ABI_FRAGMENT_COMPILER_OBJECTS = [],
} = target;
const OUTPUT_PATH = path.resolve(
  process.env.CONTRACT_PROVENANCE_OUT ||
    (targetName === "v9"
      ? ".tmp/contract-compilation-provenance.json"
      : `.tmp/contract-compilation-provenance-${targetName}.json`),
);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonicalizeSource = (value) => value.replace(/\r\n?/g, "\n");
const REVIEWED_ABI_FRAGMENT_KEYS = {
  GAME_ABI: [
    "function:placeBet(uint256,uint256)",
    "function:placeBatchBets(uint256[],uint256[])",
    "function:placeBatchBetsSameAmount(uint256[],uint256)",
    "function:placeBatchBetsBitmap(uint32,uint256)",
    "function:placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)",
    "function:claimReward(uint256)",
    "function:claimRewards(uint256[])",
    "function:claimEpochRebate(uint256)",
    "function:claimEpochsRebate(uint256[])",
    "function:settleEpochDust(uint256)",
    "function:settleEpochsDust(uint256[])",
    "function:settleEpochRebateDust(uint256)",
    "function:settleEpochsRebateDust(uint256[])",
    "function:resolveEpoch(uint256)",
    "function:claimResolverRewards()",
    "function:flushProtocolFees()",
    "function:scheduleEpochDuration(uint256)",
    "function:cancelEpochDurationChange()",
    "function:scheduleFeeRecipientChange(address)",
    "function:cancelFeeRecipientChange()",
    "function:acceptOwnership()",
    "function:token()",
    "function:currentEpoch()",
    "function:owner()",
    "function:pendingOwner()",
    "function:feeRecipient()",
    "function:epochDuration()",
    "function:getEpochEndTime(uint256)",
    "function:epochs(uint256)",
    "function:rolloverPool()",
    "function:dailyJackpotPool()",
    "function:weeklyJackpotPool()",
    "function:getJackpotInfo()",
    "function:accruedOwnerFees()",
    "function:accruedBurnFees()",
    "function:pendingResolverRewards(address)",
    "function:epochRebatePool(uint256)",
    "function:epochRebateClaimed(uint256)",
    "function:epochRewardClaimed(uint256)",
    "function:rebateClaimed(uint256,address)",
    "function:epochDustSettled(uint256)",
    "function:epochResolvedAt(uint256)",
    "function:previewRebate(uint256,address)",
    "function:getRebateInfo(uint256,address)",
    "function:getRebateSummary(address,uint256[])",
    "function:pendingEpochDuration()",
    "function:pendingEpochDurationEta()",
    "function:pendingEpochDurationEffectiveFromEpoch()",
    "function:pendingFeeRecipient()",
    "function:pendingFeeRecipientEta()",
    "function:getTileData(uint256)",
    "function:userBets(uint256,uint256,address)",
    "function:getUserBetsAll(uint256,address)",
    "function:tilePools(uint256,uint256)",
    "function:hasClaimed(address,uint256)",
    "error:ERC20InsufficientAllowance(address,uint256,uint256)",
    "error:ERC20InsufficientBalance(address,uint256,uint256)",
    "error:TimerNotEnded()",
    "error:AlreadyResolved()",
    "error:CanOnlyResolveCurrent()",
    "error:InvalidTile()",
    "error:InvalidTileMask()",
    "error:ZeroAmount()",
    "error:ArraysMismatch()",
    "error:NoWinningBet()",
    "error:AlreadyClaimed()",
    "error:NotResolved()",
    "error:InvalidEpochDuration()",
    "error:InvalidFeeRecipient()",
    "error:NoPendingEpochDurationChange()",
    "error:NoPendingFeeRecipientChange()",
    "error:NothingToFlush()",
    "error:RebateAlreadyClaimed()",
    "error:NoRebateAvailable()",
    "error:EmptyArray()",
    "error:NothingToClaim()",
    "error:InvalidTokenAddress()",
    "error:InvalidInitialOwner()",
    "error:OwnershipRenounceDisabled()",
    "error:DustAlreadySettled()",
    "error:DustSettlementDelayNotReached()",
    "error:RewardClaimWindowExpired()",
    "error:EpochClockOverflow()",
    "error:ResolutionDataOverflow()",
    "error:UserEpochVolumeOverflow()",
    "error:SafeERC20FailedOperation(address)",
    "error:ReentrancyGuardReentrantCall()",
    "error:OwnableInvalidOwner(address)",
    "error:OwnableUnauthorizedAccount(address)",
    "error:UnexpectedEpoch()",
    "error:EpochEnded()",
    "error:EpochClosing()",
  ],
  GAME_EVENTS_ABI: [
    "event:RewardClaimed(uint256,address,uint256)",
    "event:RewardBatchClaimed(address,uint256,uint256)",
    "event:BetPlaced(uint256,address,uint256,uint256)",
    "event:BatchBetsPlaced(uint256,address,uint256[],uint256[],uint256)",
    "event:BatchBetsSameAmountPlaced(uint256,address,uint256[],uint256,uint256)",
    "event:BatchBetsBitmapPlaced(uint256,address,uint32,uint256,uint256)",
    "event:EpochResolved(uint256,uint256,uint256,uint256,uint256,uint256)",
    "event:DailyJackpotAwarded(uint256,uint256)",
    "event:WeeklyJackpotAwarded(uint256,uint256)",
    "event:RewardDustSettled(uint256,uint256)",
    "event:RewardDustBatchSettled(uint256,uint256)",
    "event:ResolverRewardAccrued(address,uint256,uint256)",
    "event:ResolverRewardClaimed(address,uint256)",
    "event:ProtocolFeesFlushed(uint256,uint256)",
    "event:RebateClaimed(address,uint256,uint256)",
    "event:RebateBatchClaimed(address,uint256,uint256)",
    "event:RebateDustSettled(uint256,uint256)",
    "event:RebateDustBatchSettled(uint256,uint256)",
    "event:EpochDurationChangeScheduled(uint256,uint256,uint256,uint256)",
    "event:EpochDurationChangeCancelled(uint256)",
    "event:EpochDurationUpdated(uint256,uint256)",
    "event:FeeRecipientChangeScheduled(address,address,uint256)",
    "event:FeeRecipientChangeCancelled(address)",
    "event:FeeRecipientUpdated(address,address)",
  ],
  RESOLVE_ABI: [
    "function:resolveEpoch(uint256)",
    "function:currentEpoch()",
    "function:getEpochEndTime(uint256)",
    "function:epochs(uint256)",
    "error:TimerNotEnded()",
    "error:AlreadyResolved()",
    "error:CanOnlyResolveCurrent()",
  ],
};
const MAX_CONTRACT_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_COMPILER_CONFIG_BYTES = 512 * 1024;
const MAX_COMPILATION_MANIFEST_BYTES = 512 * 1024;
const MAX_ABI_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_LOCK_BYTES = 5 * 1024 * 1024;
const REPO_ROOT = fs.realpathSync(process.cwd());
const IMPORT_ROOTS = [
  REPO_ROOT,
  fs.realpathSync(path.resolve(REPO_ROOT, "node_modules")),
];

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

function canonicalAbiParameterType(parameter) {
  if (!parameter.type.startsWith("tuple")) return parameter.type;
  const suffix = parameter.type.slice("tuple".length);
  return `(${(parameter.components || []).map(canonicalAbiParameterType).join(",")})${suffix}`;
}

function abiItemKey(item) {
  if (!["function", "error", "event"].includes(item.type) || typeof item.name !== "string") return null;
  return `${item.type}:${item.name}(${(item.inputs || []).map(canonicalAbiParameterType).join(",")})`;
}

function selectReviewedAbiFragments(abi, supplementalCompilerAbis = []) {
  const compiledItems = new Map();
  for (const item of [abi, ...supplementalCompilerAbis].flat()) {
    const key = abiItemKey(item);
    if (!key) continue;
    if (compiledItems.has(key)) throw new Error(`Compiler ABI contains duplicate item: ${key}`);
    compiledItems.set(key, item);
  }
  return Object.fromEntries(
    Object.entries(REVIEWED_ABI_FRAGMENT_KEYS).map(([exportName, keys]) => {
      if (new Set(keys).size !== keys.length) throw new Error(`${exportName} review list contains duplicate items`);
      const items = keys.map((key) => {
        const item = compiledItems.get(key);
        if (!item) throw new Error(`${exportName} reviewed compiler ABI item is missing: ${key}`);
        return item;
      });
      return [exportName, items];
    }),
  );
}

function semanticAbiParameter(parameter) {
  return {
    name: parameter.name || "",
    type: parameter.type,
    ...(Array.isArray(parameter.components)
      ? { components: parameter.components.map(semanticAbiParameter) }
      : {}),
    ...(typeof parameter.indexed === "boolean" ? { indexed: parameter.indexed } : {}),
  };
}

function semanticAbiItem(item) {
  return {
    type: item.type,
    name: item.name,
    ...(typeof item.anonymous === "boolean" ? { anonymous: item.anonymous } : {}),
    ...(typeof item.stateMutability === "string" ? { stateMutability: item.stateMutability } : {}),
    inputs: (item.inputs || []).map(semanticAbiParameter),
    ...(Array.isArray(item.outputs) ? { outputs: item.outputs.map(semanticAbiParameter) } : {}),
  };
}

function isPathWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveContainedImportPath(importPath, roots = IMPORT_ROOTS) {
  if (typeof importPath !== "string" || importPath.length === 0 || importPath.includes("\0")) return null;
  for (const rootPath of roots) {
    const candidatePath = path.resolve(rootPath, importPath);
    if (!isPathWithinRoot(rootPath, candidatePath)) continue;
    try {
      const realCandidatePath = fs.realpathSync(candidatePath);
      if (!isPathWithinRoot(rootPath, realCandidatePath)) continue;
      if (!fs.statSync(realCandidatePath).isFile()) continue;
      return realCandidatePath;
    } catch {
      // Try the next explicitly allowed import root.
    }
  }
  return null;
}

function runImportBoundarySelfTest() {
  const systemTempRoot = fs.realpathSync(os.tmpdir());
  const fixtureRoot = fs.mkdtempSync(path.join(systemTempRoot, "lore-import-boundary-"));
  if (!isPathWithinRoot(systemTempRoot, fixtureRoot)) {
    throw new Error("Import-boundary fixture escaped the system temporary directory");
  }
  const allowedRoot = path.join(fixtureRoot, "allowed");
  const outsideRoot = path.join(fixtureRoot, "outside");
  fs.mkdirSync(allowedRoot);
  fs.mkdirSync(outsideRoot);
  const allowedFile = path.join(allowedRoot, "Allowed.sol");
  const outsideFile = path.join(outsideRoot, "Outside.sol");
  fs.writeFileSync(allowedFile, "contract Allowed {}\n", "utf8");
  fs.writeFileSync(outsideFile, "contract Outside {}\n", "utf8");
  const realAllowedRoot = fs.realpathSync(allowedRoot);
  try {
    const legitimate = resolveContainedImportPath("Allowed.sol", [realAllowedRoot]);
    if (legitimate !== fs.realpathSync(allowedFile)) throw new Error("Legitimate in-root import was rejected");
    if (resolveContainedImportPath(outsideFile, [realAllowedRoot]) !== null) {
      throw new Error("Absolute import escaped its allowed root");
    }
    if (resolveContainedImportPath(path.join("..", "outside", "Outside.sol"), [realAllowedRoot]) !== null) {
      throw new Error("Traversal import escaped its allowed root");
    }
    const linkedOutsideRoot = path.join(allowedRoot, "linked-outside");
    fs.symlinkSync(outsideRoot, linkedOutsideRoot, process.platform === "win32" ? "junction" : "dir");
    if (resolveContainedImportPath(path.join("linked-outside", "Outside.sol"), [realAllowedRoot]) !== null) {
      throw new Error("Symlink import escaped its allowed root");
    }
    return {
      status: "pass",
      legitimateImportAccepted: true,
      absoluteEscapeRejected: true,
      traversalEscapeRejected: true,
      symlinkEscapeRejected: true,
    };
  } finally {
    fs.rmSync(fixtureRoot, { force: true, recursive: true });
  }
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
  const candidate = resolveContainedImportPath(importPath);
  if (!candidate) return { error: `Import is unavailable outside the allowed roots: ${importPath}` };
  const contents = canonicalizeSource(readBoundedUtf8File(candidate, MAX_CONTRACT_SOURCE_BYTES, "Solidity import"));
  importedSources.set(importPath.replaceAll("\\", "/"), sha256(contents));
  return { contents };
};

if (SELF_TEST_IMPORT_BOUNDARY) {
  console.log(JSON.stringify(runImportBoundarySelfTest()));
  process.exit(0);
}
if (WRITE_ABI_SNAPSHOT && !ABI_SNAPSHOT_PATH) {
  throw new Error("ABI snapshots are only configured for the V10 compilation target");
}
const solc = (await import(target.compilerPackage)).default;

const compilerVersion = solc.version();
if (!compilerVersion.startsWith(target.expectedCompiler)) {
  throw new Error(`Expected solc ${target.expectedCompiler}, received ${compilerVersion}`);
}

// Solidity metadata hashes source bytes, so canonicalize checkout-specific line endings.
const source = canonicalizeSource(readBoundedUtf8File(CONTRACT_PATH, MAX_CONTRACT_SOURCE_BYTES, "contract source"));
const abiFragmentCompilerSources = Object.fromEntries(
  ABI_FRAGMENT_COMPILER_OBJECTS.map(({ sourcePath }) => {
    const resolvedSourcePath = resolveContainedImportPath(sourcePath);
    if (!resolvedSourcePath) throw new Error(`ABI fragment compiler source is unavailable: ${sourcePath}`);
    return [
      sourcePath,
      canonicalizeSource(readBoundedUtf8File(
        resolvedSourcePath,
        MAX_CONTRACT_SOURCE_BYTES,
        "ABI fragment compiler source",
      )),
    ];
  }),
);
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
  sources: {
    [CONTRACT_PATH]: { content: source },
    ...Object.fromEntries(
      Object.entries(abiFragmentCompilerSources).map(([sourcePath, content]) => [sourcePath, { content }]),
    ),
  },
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
const supplementalAbiFragmentCompilerAbis = ABI_FRAGMENT_COMPILER_OBJECTS.map(({ sourcePath, contractName }) => {
  const compilerObject = output.contracts?.[sourcePath]?.[contractName];
  if (!compilerObject) throw new Error(`ABI fragment compiler object is missing: ${sourcePath}:${contractName}`);
  return compilerObject.abi;
});
const compiledAbi = JSON.stringify(compiled.abi);
const compiledAbiSha256 = sha256(compiledAbi);
const reviewedAbiFragments = ABI_SNAPSHOT_PATH
  ? selectReviewedAbiFragments(compiled.abi, supplementalAbiFragmentCompilerAbis)
  : null;
const abiFragmentsSha256 = reviewedAbiFragments
  ? sha256(JSON.stringify(Object.fromEntries(
      Object.entries(reviewedAbiFragments).map(([name, items]) => [name, items.map(semanticAbiItem)]),
    )))
  : null;
const renderedAbiSnapshot = ABI_SNAPSHOT_PATH
  ? [
      "// Generated by scripts/check-contract-compilation-provenance.mjs --target=v10 --write-abi-snapshot.",
      "// Do not edit by hand; the pinned compiler output is the canonical source.",
      "",
      'import type { Abi } from "viem";',
      "",
      `export const LINEA_ORE_V10_ABI_SHA256 = "${compiledAbiSha256}" as const;`,
      `export const LINEA_ORE_V10_ABI_FRAGMENTS_SHA256 = "${abiFragmentsSha256}" as const;`,
      "",
      `export const LINEA_ORE_V10_ABI = ${JSON.stringify(compiled.abi, null, 2)} as const satisfies Abi;`,
      "",
      ...Object.entries(reviewedAbiFragments).flatMap(([name, items]) => [
        `export const ${name} = ${JSON.stringify(items, null, 2)} as const satisfies Abi;`,
        "",
      ]),
    ].join("\n")
  : null;
const compiledBytecode = compiled.evm.bytecode.object.toLowerCase();
const compiledRuntimeBytecode = compiled.evm.deployedBytecode.object.toLowerCase();
const observed = {
  compilerVersion,
  settings:
    targetName === "v9"
      ? { optimizer: true, runs: 200, evmVersion: "osaka" }
      : { optimizer: true, runs: 200, viaIR: false, evmVersion: "osaka" },
  sourceSha256: sha256(source),
  abiSha256: compiledAbiSha256,
  ...(abiFragmentsSha256 ? { abiFragmentsSha256 } : {}),
  ...(Object.keys(abiFragmentCompilerSources).length > 0
    ? {
        abiFragmentCompilerSourceUnitsSha256: Object.fromEntries(
          Object.entries(abiFragmentCompilerSources).map(([sourcePath, content]) => [sourcePath, sha256(content)]),
        ),
      }
    : {}),
  ...(renderedAbiSnapshot ? { abiSnapshotSha256: sha256(renderedAbiSnapshot) } : {}),
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
let abiSnapshotMatches = true;
if (ABI_SNAPSHOT_PATH && renderedAbiSnapshot) {
  if (WRITE_ABI_SNAPSHOT && !SUMMARY_ONLY) {
    fs.mkdirSync(path.dirname(ABI_SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(ABI_SNAPSHOT_PATH, renderedAbiSnapshot, "utf8");
  }
  try {
    const actualAbiSnapshot = canonicalizeSource(
      readBoundedUtf8File(ABI_SNAPSHOT_PATH, MAX_ABI_SNAPSHOT_BYTES, "generated ABI snapshot"),
    );
    abiSnapshotMatches = actualAbiSnapshot === renderedAbiSnapshot;
  } catch {
    abiSnapshotMatches = false;
  }
}
if (process.argv.includes("--write-manifest") && !SUMMARY_ONLY) {
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(observed, null, 2)}\n`, "utf8");
}
const expectedRaw = readBoundedUtf8File(MANIFEST_PATH, MAX_COMPILATION_MANIFEST_BYTES, "compilation manifest");
const expected = JSON.parse(expectedRaw);
const compilationManifestSha256 = sha256(expectedRaw);
const manifestMatches = JSON.stringify(observed) === JSON.stringify(expected);
const result = {
  status: manifestMatches && abiSnapshotMatches ? "pass" : "fail",
  ...observed,
  manifestMatches,
  ...(ABI_SNAPSHOT_PATH ? { abiSnapshotMatches } : {}),
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
          compilationManifestSha256,
          normalizedExecutableRuntimeSha256: result.normalizedExecutableRuntimeSha256,
          runtimeBytecodeSha256: result.runtimeBytecodeSha256,
          sourceSha256: result.sourceSha256,
          abiFragmentsSha256: result.abiFragmentsSha256,
          manifestMatches: result.manifestMatches,
          abiSnapshotMatches: result.abiSnapshotMatches,
          wouldWrite: false,
        }
      : result,
  ),
);
if (result.status !== "pass") process.exitCode = 1;
