import "dotenv/config";

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  createPublicClient,
  fallback,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  BaseError,
  ContractFunctionRevertedError,
  toFunctionSelector,
  type Address,
} from "viem";

import {
  CONTRACT_ADDRESS,
  CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
  GAME_ABI,
  LINEA_TOKEN_ADDRESS,
  TOKEN_ABI,
} from "../app/lib/constants";
import { parseOptionalPositiveIntegerInRangeEnv } from "../config/envParsing";
import {
  DEFAULT_SEPOLIA_EXPECTED_CURRENT_FEE_RECIPIENT_ADDRESS,
  DEFAULT_SEPOLIA_EXPECTED_CURRENT_EPOCH_DURATION,
  DEFAULT_SEPOLIA_EXPECTED_CURRENT_OWNER_ADDRESS,
  getConfiguredLineaNetwork,
  getLineaChain,
  getStableLineaReadRpcs,
} from "../config/publicConfig";

const APP_NETWORK = getConfiguredLineaNetwork();
const APP_CHAIN = getLineaChain(APP_NETWORK);
const ROLE_NAMES = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C", "RESOLVER"] as const;
const SUMMARY_ONLY = process.argv.includes("--summary-only");
const MAX_SCAN_EPOCHS = parseOptionalPositiveIntegerInRangeEnv(
  process.env.V10_POSTDEPLOY_SCAN_EPOCHS,
  64,
  1,
  5000,
);
const READ_BATCH_SIZE = 4;
const DUST_SETTLE_DELAY = 365n * 24n * 60n * 60n;
const RESOLVE_GAS_FLOOR = 500_000n;
const GAS_LIMIT_HEADROOM_BPS = 13_000n;
const BPS_DENOMINATOR = 10_000n;
const GAS_LIMIT_BUFFER = 20_000n;
const COMPILATION_MANIFEST_PATH = "contracts/LineaOreV10.compilation.json";
const MAX_V10_COMPILATION_MANIFEST_BYTES = 512 * 1024;
const MAX_V10_PUBLIC_ADDRESS_FILE_BYTES = 64 * 1024;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EPOCH_BOUND_BITMAP_SELECTOR = toFunctionSelector(
  "placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)",
);
const POSTDEPLOY_AUDIT_ABI = [
  ...GAME_ABI,
  ...parseAbi(["function renounceOwnership() external"]),
] as const;

type RoleName = (typeof ROLE_NAMES)[number];
type RoleAddress = { role: RoleName; address: Address };
type ResolvedEpoch = {
  epoch: bigint;
  rewardPool: bigint;
  rewardClaimed: bigint;
  winningTile: bigint;
  winningPool: bigint;
  resolvedAt: bigint;
  rebatePool: bigint;
  rebateClaimed: bigint;
  rewardDustSettled: boolean;
};
type PlannedCall = {
  account: Address;
  args: readonly unknown[];
  functionName:
    | "claimEpochsRebate"
    | "claimResolverRewards"
    | "claimRewards"
    | "flushProtocolFees"
    | "resolveEpoch";
  label: string;
};

type SanitizedPlannedCall = {
  role: RoleName;
  functionName: PlannedCall["functionName"];
  epochs: string[];
  estimatedGas: string;
  recommendedGasLimit: string;
  expectedTransferLinea: string;
};

type NegativeCall = {
  account: Address;
  args: readonly unknown[];
  expectedError: string;
  functionName:
    | "cancelEpochDurationChange"
    | "cancelFeeRecipientChange"
    | "claimEpochRebate"
    | "claimEpochsRebate"
    | "claimResolverRewards"
    | "claimReward"
    | "claimRewards"
    | "placeBatchBets"
    | "placeBatchBetsBitmapForEpoch"
    | "placeBet"
    | "renounceOwnership"
    | "resolveEpoch"
    | "scheduleEpochDuration"
    | "scheduleFeeRecipientChange"
    | "settleEpochDust"
    | "settleEpochRebateDust"
    | "settleEpochsDust"
    | "settleEpochsRebateDust";
  label: string;
};

class SafePlanError extends Error {}

function readBoundedUtf8File(filePath: string, maxBytes: number, label: string) {
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new SafePlanError(`${label} must be a file: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw new SafePlanError(`${label} is too large to validate safely: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function getRecommendedGasLimit(estimatedGas: bigint) {
  return (estimatedGas * GAS_LIMIT_HEADROOM_BPS) / BPS_DENOMINATOR + GAS_LIMIT_BUFFER;
}

function readExpectedGovernanceAddress(envName: string, fallbackAddress: string): Address {
  const raw = process.env[envName]?.trim() || fallbackAddress;
  try {
    return getAddress(raw);
  } catch {
    throw new SafePlanError(`${envName} must be a valid address`);
  }
}

type RuntimeIdentityManifest = {
  executableRuntimeBytes: number;
  normalizedExecutableRuntimeSha256: string;
  runtimeImmutableReferences: Array<{ length: number; start: number }>;
};

function readRuntimeIdentityManifest(): RuntimeIdentityManifest {
  let manifest: Partial<RuntimeIdentityManifest>;
  try {
    manifest = JSON.parse(
      readBoundedUtf8File(
        COMPILATION_MANIFEST_PATH,
        MAX_V10_COMPILATION_MANIFEST_BYTES,
        "Canonical V10 compilation manifest",
      ),
    );
  } catch (error) {
    if (error instanceof SafePlanError) throw error;
    throw new SafePlanError("Canonical V10 compilation manifest is unavailable");
  }
  const references = manifest.runtimeImmutableReferences;
  if (
    !Number.isSafeInteger(manifest.executableRuntimeBytes) ||
    Number(manifest.executableRuntimeBytes) <= 0 ||
    !/^[0-9a-f]{64}$/.test(manifest.normalizedExecutableRuntimeSha256 ?? "") ||
    !Array.isArray(references) ||
    references.length === 0
  ) {
    throw new SafePlanError("Canonical V10 runtime identity is missing from the compilation manifest");
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
      throw new SafePlanError("Canonical V10 immutable reference layout is invalid");
    }
    previousEnd = reference.start + reference.length;
  }
  return manifest as RuntimeIdentityManifest;
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

function normalizeExecutableRuntime(bytecode: string, manifest: RuntimeIdentityManifest) {
  const executable = stripSolidityMetadata(bytecode.slice(2).toLowerCase());
  if (executable.length / 2 !== manifest.executableRuntimeBytes) {
    throw new SafePlanError("Deployed V10 executable runtime size does not match the canonical manifest");
  }
  let normalized = executable;
  for (const reference of manifest.runtimeImmutableReferences) {
    const start = reference.start * 2;
    normalized = `${normalized.slice(0, start)}${"0".repeat(reference.length * 2)}${normalized.slice(start + reference.length * 2)}`;
  }
  const digest = createHash("sha256").update(normalized).digest("hex");
  if (digest !== manifest.normalizedExecutableRuntimeSha256) {
    throw new SafePlanError("Deployed V10 executable runtime does not match the canonical manifest");
  }
  return {
    executableBytes: manifest.executableRuntimeBytes,
    immutableReferences: manifest.runtimeImmutableReferences.length,
    manifestMatched: true,
  };
}

function classifyError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
  if (/timeout|network|fetch|http request|rpc|socket|429/.test(text)) return "rpc-unavailable";
  if (/revert|execution|contract function/.test(text)) return "contract-revert";
  return "unexpected";
}

function formatRatio(numerator: bigint, denominator: bigint, precision = 6) {
  if (denominator == 0n) return null;
  const scale = 10n ** BigInt(precision);
  const scaled = (numerator * scale) / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(precision, "0");
  return `${whole}.${fraction}`;
}

function plannedCallCount(ready: boolean) {
  return ready ? 1 : 0;
}

async function mapInBatches<T, R>(values: readonly T[], mapper: (value: T) => Promise<R>) {
  const results: R[] = [];
  for (let offset = 0; offset < values.length; offset += READ_BATCH_SIZE) {
    results.push(...await Promise.all(values.slice(offset, offset + READ_BATCH_SIZE).map(mapper)));
  }
  return results;
}

function parsePublicAddressEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.replace(/^export\s+/, "").match(/^([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
  if (!match) return null;
  return {
    name: match[1],
    value: match[2].trim().replace(/^["']|["']$/g, ""),
  };
}

function readPublicRoleAddresses(): RoleAddress[] {
  const addressFile = ".env.live-test-addresses";
  const fileValues = new Map(
    existsSync(addressFile)
      ? readBoundedUtf8File(
          addressFile,
          MAX_V10_PUBLIC_ADDRESS_FILE_BYTES,
          "public-only address file",
        )
          .replace(/^\uFEFF/, "")
          .split(/\r?\n/)
          .map(parsePublicAddressEnvLine)
          .filter((entry): entry is { name: string; value: string } => entry !== null)
          .map((entry) => [entry.name, entry.value] as const)
      : [],
  );
  const rows = ROLE_NAMES.map((role) => {
    const name = `LORE_LIVE_TEST_${role}_ADDRESS`;
    const fromFile = fileValues.get(name);
    const raw = process.env[name]?.trim() || fromFile;
    if (!raw) {
      throw new SafePlanError(
        `Missing public address for role ${role}; set ${name} or add it to the public-only ${addressFile}`,
      );
    }
    return { role, address: getAddress(raw) };
  });
  if (new Set(rows.map((row) => row.address.toLowerCase())).size !== rows.length) {
    throw new SafePlanError("Live-test role addresses must be distinct");
  }
  return rows;
}

async function simulateAndEstimate(
  client: ReturnType<typeof createPublicClient>,
  call: PlannedCall,
  snapshotBlock: bigint,
) {
  try {
    await client.simulateContract({
      account: call.account,
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: call.functionName,
      args: call.args,
      blockNumber: snapshotBlock,
    } as never);
    return await client.estimateContractGas({
      account: call.account,
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: call.functionName,
      args: call.args,
      blockNumber: snapshotBlock,
    } as never);
  } catch (error) {
    throw new SafePlanError(`${call.label} read-only simulation failed (${classifyError(error)})`);
  }
}

async function requireExpectedRevert(
  client: ReturnType<typeof createPublicClient>,
  call: NegativeCall,
  snapshotBlock: bigint,
) {
  try {
    await client.simulateContract({
      account: call.account,
      address: CONTRACT_ADDRESS,
      abi: POSTDEPLOY_AUDIT_ABI,
      functionName: call.functionName,
      args: call.args,
      blockNumber: snapshotBlock,
    } as never);
  } catch (error) {
    const reverted = error instanceof BaseError
      ? error.walk((entry) => entry instanceof ContractFunctionRevertedError)
      : null;
    const errorName = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : null;
    if (errorName === call.expectedError) {
      return { check: call.label, expectedError: call.expectedError, passed: true };
    }
    throw new SafePlanError(
      `${call.label} returned ${errorName ? "an unexpected contract error" : classifyError(error)}`,
    );
  }
  throw new SafePlanError(`${call.label} unexpectedly succeeded`);
}

async function main() {
  if (APP_NETWORK !== "sepolia" || APP_CHAIN.id !== 59141) {
    throw new SafePlanError("Post-deploy canary planning is restricted to Linea Sepolia");
  }
  if (!CONTRACT_REQUIRES_EPOCH_BOUND_BETS) {
    throw new SafePlanError("V10 post-deploy planning requires epoch-bound runtime mode");
  }
  const expectedOwner = readExpectedGovernanceAddress(
    "V10_EXPECTED_CURRENT_OWNER",
    DEFAULT_SEPOLIA_EXPECTED_CURRENT_OWNER_ADDRESS,
  );
  const expectedFeeRecipient = readExpectedGovernanceAddress(
    "V10_EXPECTED_CURRENT_FEE_RECIPIENT",
    DEFAULT_SEPOLIA_EXPECTED_CURRENT_FEE_RECIPIENT_ADDRESS,
  );
  const expectedEpochDuration = parseOptionalPositiveIntegerInRangeEnv(
    process.env.V10_EXPECTED_CURRENT_EPOCH_DURATION,
    DEFAULT_SEPOLIA_EXPECTED_CURRENT_EPOCH_DURATION,
    15,
    3600,
  );

  const runtimeIdentityManifest = readRuntimeIdentityManifest();
  const roles = readPublicRoleAddresses();
  const rpcUrls = getStableLineaReadRpcs(process.env.NEXT_PUBLIC_LINEA_RPCS, APP_NETWORK);
  const client = createPublicClient({
    chain: APP_CHAIN,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
  });

  const [chainId, block] = await Promise.all([
    client.getChainId(),
    client.getBlock(),
  ]);
  if (chainId !== APP_CHAIN.id) throw new SafePlanError("RPC chain does not match Linea Sepolia");
  const snapshotBlock = block.number;
  const readSnapshot = { blockNumber: snapshotBlock } as const;
  const [bytecode, tokenBytecode, contractToken, tokenDecimals, currentEpoch, contractBalance, currentGasPrice] = await Promise.all([
    client.getBytecode({ address: CONTRACT_ADDRESS, blockNumber: snapshotBlock }),
    client.getBytecode({ address: LINEA_TOKEN_ADDRESS, blockNumber: snapshotBlock }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "token", ...readSnapshot }),
    client.readContract({ address: LINEA_TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: "decimals", ...readSnapshot }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch", ...readSnapshot }),
    client.readContract({
      address: LINEA_TOKEN_ADDRESS,
      abi: TOKEN_ABI,
      functionName: "balanceOf",
      args: [CONTRACT_ADDRESS],
      ...readSnapshot,
    }),
    client.getGasPrice(),
  ]);
  if (!bytecode) throw new SafePlanError("Configured V10 contract has no deployed bytecode");
  if (!tokenBytecode) throw new SafePlanError("Configured token has no deployed bytecode");
  const runtimeIdentity = normalizeExecutableRuntime(bytecode, runtimeIdentityManifest);
  if (String(contractToken).toLowerCase() !== LINEA_TOKEN_ADDRESS.toLowerCase()) {
    throw new SafePlanError("Configured token does not match deployed token()");
  }
  if (tokenDecimals !== 18) throw new SafePlanError("Configured token must use 18 decimals");
  if (!bytecode?.toLowerCase().includes(EPOCH_BOUND_BITMAP_SELECTOR.slice(2).toLowerCase())) {
    throw new SafePlanError("Deployed contract is missing required epoch-bound betting support");
  }

  const [
    ownerFees,
    burnFees,
    rolloverPool,
    dailyJackpotPool,
    weeklyJackpotPool,
    currentData,
    currentEndTime,
    owner,
    feeRecipient,
    epochDuration,
    pendingOwner,
    pendingDuration,
    pendingFeeRecipient,
  ] =
    await Promise.all([
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "accruedOwnerFees", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "accruedBurnFees", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "rolloverPool", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "dailyJackpotPool", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "weeklyJackpotPool", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs", args: [currentEpoch], ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getEpochEndTime", args: [currentEpoch], ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "owner", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "feeRecipient", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochDuration", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "pendingOwner", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "pendingEpochDuration", ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "pendingFeeRecipient", ...readSnapshot }),
    ]);
  const ownerMatches = getAddress(owner as Address) === expectedOwner;
  const feeRecipientMatches = getAddress(feeRecipient as Address) === expectedFeeRecipient;
  const epochDurationMatches = epochDuration === BigInt(expectedEpochDuration);
  const pendingOwnerChange = String(pendingOwner).toLowerCase() !== ZERO_ADDRESS;
  const pendingDurationChange = pendingDuration > 0n;
  const pendingFeeRecipientChange = String(pendingFeeRecipient).toLowerCase() !== ZERO_ADDRESS;
  const adminBlockReason = !ownerMatches || !feeRecipientMatches || !epochDurationMatches
    ? "current governance state does not match expected configuration"
    : pendingOwnerChange || pendingDurationChange || pendingFeeRecipientChange
      ? "pending governance change requires explicit review"
      : null;
  const adminStateClean = adminBlockReason === null;
  const resolveReady = currentData[0] > 0n && !currentData[3] && block.timestamp >= currentEndTime;
  const resolvePlanningReady = resolveReady && adminStateClean;

  const scanFrom = currentEpoch > BigInt(MAX_SCAN_EPOCHS) ? currentEpoch - BigInt(MAX_SCAN_EPOCHS) : 1n;
  const scanComplete = scanFrom === 1n;
  const claimPlanningReady = scanComplete && !resolveReady && adminStateClean;
  const claimPlanningSkipReason = !adminStateClean
    ? adminBlockReason
    : resolveReady
      ? "current epoch resolve must be mined before claim/flush planning"
      : !scanComplete
        ? "resolved-history scan is truncated"
        : null;
  const resolverRewardsByRole = new Map(
    await mapInBatches(roles, async (role) => [
      role.role,
      await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "pendingResolverRewards",
        args: [role.address],
        ...readSnapshot,
      }),
    ] as const),
  );
  const knownResolverLiability = [...resolverRewardsByRole.values()].reduce((total, amount) => total + amount, 0n);
  const epochsToScan: bigint[] = [];
  for (let epoch = scanFrom; epoch < currentEpoch; epoch += 1n) {
    epochsToScan.push(epoch);
  }
  const scannedEpochs = await mapInBatches<bigint, ResolvedEpoch | null>(epochsToScan, async (epoch) => {
    const [epochData, resolvedAt, rebatePool, rebateClaimed, rewardClaimed, rewardDustSettled] = await Promise.all([
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochs", args: [epoch], ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochResolvedAt", args: [epoch], ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochRebatePool", args: [epoch], ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochRebateClaimed", args: [epoch], ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochRewardClaimed", args: [epoch], ...readSnapshot }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "epochDustSettled", args: [epoch], ...readSnapshot }),
    ]);
    if (!epochData[3]) return null;
    const winningPool = claimPlanningReady && epochData[1] > 0n
      ? await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "tilePools",
          args: [epoch, epochData[2]],
          ...readSnapshot,
        })
      : 0n;
    return {
      epoch,
      rewardPool: epochData[1],
      rewardClaimed,
      winningTile: epochData[2],
      winningPool,
      resolvedAt,
      rebatePool,
      rebateClaimed,
      rewardDustSettled,
    };
  });
  const resolvedEpochs = scannedEpochs.filter((epoch): epoch is ResolvedEpoch => epoch !== null);
  let outstandingRewardLiability = 0n;
  let outstandingRebateLiability = 0n;
  for (const epoch of resolvedEpochs) {
    if (epoch.rewardClaimed > epoch.rewardPool || epoch.rebateClaimed > epoch.rebatePool) {
      throw new SafePlanError("Resolved epoch claimed accounting exceeds its pool");
    }
    if (!epoch.rewardDustSettled) outstandingRewardLiability += epoch.rewardPool - epoch.rewardClaimed;
    outstandingRebateLiability += epoch.rebatePool - epoch.rebateClaimed;
  }
  const lowerBoundLiability =
    currentData[0] +
    rolloverPool +
    dailyJackpotPool +
    weeklyJackpotPool +
    ownerFees +
    burnFees +
    knownResolverLiability +
    outstandingRewardLiability +
    outstandingRebateLiability;
  const lowerBoundCovered = contractBalance >= lowerBoundLiability;
  const lowerBoundResidual = lowerBoundCovered ? contractBalance - lowerBoundLiability : 0n;
  const lowerBoundDeficit = lowerBoundCovered ? 0n : lowerBoundLiability - contractBalance;

  let claimPhaseTransactions = 0;
  let claimPhaseGas = 0n;
  let claimPhaseTransfers = 0n;
  const claimPhaseCalls: SanitizedPlannedCall[] = [];
  const rolePlans = [];
  const rolesToPlan = claimPlanningReady ? roles : [];
  for (const role of rolesToPlan) {
    const rewardEpochs: bigint[] = [];
    const rebateEpochs: bigint[] = [];
    let rewardAmount = 0n;
    let rebateAmount = 0n;
    const roleEpochStates = await mapInBatches(resolvedEpochs, async (epoch) => {
      const [userBet, rewardClaimed, rebateInfo] = await Promise.all([
        client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "userBets",
          args: [epoch.epoch, epoch.winningTile, role.address],
          ...readSnapshot,
        }),
        client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "hasClaimed",
          args: [role.address, epoch.epoch],
          ...readSnapshot,
        }),
        client.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "getRebateInfo",
          args: [epoch.epoch, role.address],
          ...readSnapshot,
        }),
      ]);
      return { epoch, userBet, rewardClaimed, rebateInfo };
    });
    for (const { epoch, userBet, rewardClaimed, rebateInfo } of roleEpochStates) {
      const claimWindowOpen = epoch.resolvedAt > 0n && block.timestamp < epoch.resolvedAt + DUST_SETTLE_DELAY;
      if (claimWindowOpen && !rewardClaimed && userBet > 0n && epoch.rewardPool > 0n) {
        const amount = epoch.winningPool > 0n ? (epoch.rewardPool * userBet) / epoch.winningPool : 0n;
        if (amount > 0n) {
          rewardEpochs.push(epoch.epoch);
          rewardAmount += amount;
        }
      }
      if (rebateInfo[2] > 0n && !rebateInfo[3]) {
        rebateEpochs.push(epoch.epoch);
        rebateAmount += rebateInfo[2];
      }
    }

    let roleGas = 0n;
    if (rewardEpochs.length > 0) {
      const estimatedGas = await simulateAndEstimate(client, {
        account: role.address,
        functionName: "claimRewards",
        args: [rewardEpochs],
        label: `${role.role} reward batch`,
      }, snapshotBlock);
      roleGas += estimatedGas;
      claimPhaseCalls.push({
        role: role.role,
        functionName: "claimRewards",
        epochs: rewardEpochs.map(String),
        estimatedGas: estimatedGas.toString(),
        recommendedGasLimit: getRecommendedGasLimit(estimatedGas).toString(),
        expectedTransferLinea: formatUnits(rewardAmount, 18),
      });
      claimPhaseTransactions += 1;
    }
    if (rebateEpochs.length > 0) {
      const estimatedGas = await simulateAndEstimate(client, {
        account: role.address,
        functionName: "claimEpochsRebate",
        args: [rebateEpochs],
        label: `${role.role} rebate batch`,
      }, snapshotBlock);
      roleGas += estimatedGas;
      claimPhaseCalls.push({
        role: role.role,
        functionName: "claimEpochsRebate",
        epochs: rebateEpochs.map(String),
        estimatedGas: estimatedGas.toString(),
        recommendedGasLimit: getRecommendedGasLimit(estimatedGas).toString(),
        expectedTransferLinea: formatUnits(rebateAmount, 18),
      });
      claimPhaseTransactions += 1;
    }
    const resolverReward = resolverRewardsByRole.get(role.role) ?? 0n;
    if (resolverReward > 0n) {
      const estimatedGas = await simulateAndEstimate(client, {
        account: role.address,
        functionName: "claimResolverRewards",
        args: [],
        label: `${role.role} resolver reward`,
      }, snapshotBlock);
      roleGas += estimatedGas;
      claimPhaseCalls.push({
        role: role.role,
        functionName: "claimResolverRewards",
        epochs: [],
        estimatedGas: estimatedGas.toString(),
        recommendedGasLimit: getRecommendedGasLimit(estimatedGas).toString(),
        expectedTransferLinea: formatUnits(resolverReward, 18),
      });
      claimPhaseTransactions += 1;
    }
    claimPhaseGas += roleGas;
    claimPhaseTransfers += rewardAmount + rebateAmount + resolverReward;
    rolePlans.push({
      role: role.role,
      rewardEpochs: rewardEpochs.map(String),
      rebateEpochs: rebateEpochs.map(String),
      resolverRewardLinea: formatUnits(resolverReward, 18),
      claimAmountLinea: formatUnits(rewardAmount + rebateAmount, 18),
      plannedTransactions:
        plannedCallCount(rewardEpochs.length > 0) +
        plannedCallCount(rebateEpochs.length > 0) +
        plannedCallCount(resolverReward > 0n),
      estimatedGas: roleGas.toString(),
    });
  }

  let feeFlushGas = 0n;
  if (claimPlanningReady && (ownerFees > 0n || burnFees > 0n)) {
    feeFlushGas = await simulateAndEstimate(client, {
      account: roles[0].address,
      functionName: "flushProtocolFees",
      args: [],
      label: "protocol fee flush",
    }, snapshotBlock);
    claimPhaseCalls.push({
      role: roles[0].role,
      functionName: "flushProtocolFees",
      epochs: [],
      estimatedGas: feeFlushGas.toString(),
      recommendedGasLimit: getRecommendedGasLimit(feeFlushGas).toString(),
      expectedTransferLinea: formatUnits(ownerFees + burnFees, 18),
    });
    claimPhaseTransactions += 1;
    claimPhaseGas += feeFlushGas;
    claimPhaseTransfers += ownerFees + burnFees;
  }
  if (claimPhaseCalls.length !== claimPhaseTransactions) {
    throw new SafePlanError("Sanitized claim call manifest does not match its transaction limit");
  }
  const claimManifestGas = claimPhaseCalls.reduce(
    (total, call) => total + BigInt(call.estimatedGas),
    0n,
  );
  const claimManifestTransfers = claimPhaseCalls.reduce(
    (total, call) => total + parseUnits(call.expectedTransferLinea, 18),
    0n,
  );
  if (claimManifestGas !== claimPhaseGas) {
    throw new SafePlanError("Sanitized claim call manifest gas does not match its aggregate");
  }
  if (claimManifestTransfers !== claimPhaseTransfers) {
    throw new SafePlanError("Sanitized claim call manifest transfers do not match their aggregate");
  }
  if (claimPhaseCalls.some((call) => BigInt(call.recommendedGasLimit) <= BigInt(call.estimatedGas))) {
    throw new SafePlanError("Sanitized claim call manifest has an unsafe gas limit");
  }

  let resolveGas = 0n;
  if (resolvePlanningReady) {
    resolveGas = await simulateAndEstimate(client, {
      account: roles[0].address,
      functionName: "resolveEpoch",
      args: [currentEpoch],
      label: "current funded epoch resolve",
    }, snapshotBlock);
  }
  const expectedResolverReward = (currentData[0] * 5n) / 10_000n;
  const estimatedResolveFee = resolveGas * currentGasPrice;
  const bufferedResolveGas = getRecommendedGasLimit(resolveGas);
  const recommendedResolveGasLimit = resolvePlanningReady
    ? bufferedResolveGas > RESOLVE_GAS_FLOOR ? bufferedResolveGas : RESOLVE_GAS_FLOOR
    : 0n;

  const rewardDustEligible = resolvedEpochs.filter(
    (epoch) =>
      epoch.resolvedAt > 0n &&
      block.timestamp >= epoch.resolvedAt + DUST_SETTLE_DELAY &&
      !epoch.rewardDustSettled,
  ).length;
  const rebateDustEligible = resolvedEpochs.filter(
    (epoch) =>
      epoch.resolvedAt > 0n &&
      block.timestamp >= epoch.resolvedAt + DUST_SETTLE_DELAY &&
      epoch.rebateClaimed < epoch.rebatePool,
  ).length;

  const nonOwner = roles.find((role) => role.address.toLowerCase() !== String(owner).toLowerCase());
  if (!nonOwner) throw new SafePlanError("No non-owner role is available for deployed access-control checks");
  const firstResolved = resolvedEpochs[0];
  if (currentEpoch <= 1n || !firstResolved) {
    throw new SafePlanError("Deployed negative checks require one prior resolved epoch");
  }
  const firstResolvedEpoch = firstResolved.epoch;
  const openClaimWindowEpoch = resolvedEpochs.find(
    (epoch) => epoch.resolvedAt > 0n && block.timestamp < epoch.resolvedAt + DUST_SETTLE_DELAY,
  );
  const rewardNegativeEpoch = openClaimWindowEpoch ?? firstResolved;
  const negativeCalls: NegativeCall[] = [
    {
      account: roles[0].address,
      functionName: "claimReward",
      args: [currentEpoch],
      expectedError: "NotResolved",
      label: "unresolved single reward claim",
    },
    {
      account: "0x0000000000000000000000000000000000000000",
      functionName: "claimReward",
      args: [rewardNegativeEpoch.epoch],
      expectedError: openClaimWindowEpoch ? "NoWinningBet" : "RewardClaimWindowExpired",
      label: openClaimWindowEpoch
        ? "resolved non-winning single reward claim"
        : "expired single reward claim",
    },
    {
      account: "0x0000000000000000000000000000000000000000",
      functionName: "claimRewards",
      args: [[firstResolvedEpoch]],
      expectedError: "NothingToClaim",
      label: "resolved non-winning reward batch",
    },
    {
      account: roles[0].address,
      functionName: "claimEpochRebate",
      args: [currentEpoch],
      expectedError: "NotResolved",
      label: "unresolved single rebate claim",
    },
    {
      account: "0x0000000000000000000000000000000000000000",
      functionName: "claimEpochRebate",
      args: [firstResolvedEpoch],
      expectedError: "NoRebateAvailable",
      label: "resolved empty-account single rebate claim",
    },
    {
      account: "0x0000000000000000000000000000000000000000",
      functionName: "claimEpochsRebate",
      args: [[firstResolvedEpoch]],
      expectedError: "NoRebateAvailable",
      label: "resolved empty-account rebate batch",
    },
    {
      account: "0x0000000000000000000000000000000000000000",
      functionName: "claimResolverRewards",
      args: [],
      expectedError: "NothingToClaim",
      label: "empty resolver reward claim",
    },
    {
      account: roles[0].address,
      functionName: "placeBatchBetsBitmapForEpoch",
      args: [currentEpoch - 1n, 1n, 1n],
      expectedError: "UnexpectedEpoch",
      label: "stale protected bet",
    },
    {
      account: roles[0].address,
      functionName: "placeBatchBetsBitmapForEpoch",
      args: [currentEpoch, 0n, 1n],
      expectedError: "EmptyArray",
      label: "zero bitmap",
    },
    {
      account: roles[0].address,
      functionName: "placeBatchBetsBitmapForEpoch",
      args: [currentEpoch, 1n << 25n, 1n],
      expectedError: "InvalidTileMask",
      label: "out-of-grid bitmap",
    },
    {
      account: roles[0].address,
      functionName: "placeBatchBetsBitmapForEpoch",
      args: [currentEpoch, 1n, 0n],
      expectedError: "ZeroAmount",
      label: "zero bet amount",
    },
    {
      account: roles[0].address,
      functionName: "placeBet",
      args: [0n, 1n],
      expectedError: "InvalidTile",
      label: "out-of-grid single tile",
    },
    {
      account: roles[0].address,
      functionName: "placeBatchBets",
      args: [[1n], [1n, 2n]],
      expectedError: "ArraysMismatch",
      label: "mismatched batch arrays",
    },
    {
      account: roles[0].address,
      functionName: "resolveEpoch",
      args: [currentEpoch - 1n],
      expectedError: "CanOnlyResolveCurrent",
      label: "non-current resolve",
    },
    {
      account: roles[0].address,
      functionName: "settleEpochsDust",
      args: [[]],
      expectedError: "EmptyArray",
      label: "empty reward dust batch",
    },
    {
      account: roles[0].address,
      functionName: "settleEpochsRebateDust",
      args: [[]],
      expectedError: "EmptyArray",
      label: "empty rebate dust batch",
    },
    {
      account: nonOwner.address,
      functionName: "scheduleEpochDuration",
      args: [60n],
      expectedError: "OwnableUnauthorizedAccount",
      label: "unauthorized epoch-duration schedule",
    },
    {
      account: nonOwner.address,
      functionName: "scheduleFeeRecipientChange",
      args: [roles[0].address],
      expectedError: "OwnableUnauthorizedAccount",
      label: "unauthorized fee-recipient schedule",
    },
    {
      account: owner as Address,
      functionName: "scheduleEpochDuration",
      args: [14n],
      expectedError: "InvalidEpochDuration",
      label: "epoch duration below minimum",
    },
    {
      account: owner as Address,
      functionName: "scheduleEpochDuration",
      args: [3601n],
      expectedError: "InvalidEpochDuration",
      label: "epoch duration above maximum",
    },
    {
      account: owner as Address,
      functionName: "scheduleFeeRecipientChange",
      args: [ZERO_ADDRESS],
      expectedError: "InvalidFeeRecipient",
      label: "zero fee recipient",
    },
    {
      account: owner as Address,
      functionName: "scheduleFeeRecipientChange",
      args: [CONTRACT_ADDRESS],
      expectedError: "InvalidFeeRecipient",
      label: "contract fee recipient",
    },
    {
      account: owner as Address,
      functionName: "renounceOwnership",
      args: [],
      expectedError: "OwnershipRenounceDisabled",
      label: "ownership renounce disabled",
    },
  ];
  if (!pendingDurationChange) {
    negativeCalls.push({
      account: owner as Address,
      functionName: "cancelEpochDurationChange",
      args: [],
      expectedError: "NoPendingEpochDurationChange",
      label: "cancel absent epoch-duration change",
    });
  }
  if (!pendingFeeRecipientChange) {
    negativeCalls.push({
      account: owner as Address,
      functionName: "cancelFeeRecipientChange",
      args: [],
      expectedError: "NoPendingFeeRecipientChange",
      label: "cancel absent fee-recipient change",
    });
  }
  if (resolveReady) {
    negativeCalls.push({
      account: roles[0].address,
      functionName: "placeBatchBetsBitmapForEpoch",
      args: [currentEpoch, 1n, 1n],
      expectedError: "EpochClosing",
      label: "funded expired protected bet",
    });
  }
  if (openClaimWindowEpoch) {
    negativeCalls.push(
      {
        account: roles[0].address,
        functionName: "settleEpochDust",
        args: [openClaimWindowEpoch.epoch],
        expectedError: "DustSettlementDelayNotReached",
        label: "premature reward dust settlement",
      },
      {
        account: roles[0].address,
        functionName: "settleEpochRebateDust",
        args: [openClaimWindowEpoch.epoch],
        expectedError: "DustSettlementDelayNotReached",
        label: "premature rebate dust settlement",
      },
      {
        account: roles[0].address,
        functionName: "settleEpochsDust",
        args: [[openClaimWindowEpoch.epoch]],
        expectedError: "NothingToClaim",
        label: "premature reward dust batch",
      },
      {
        account: roles[0].address,
        functionName: "settleEpochsRebateDust",
        args: [[openClaimWindowEpoch.epoch]],
        expectedError: "NothingToClaim",
        label: "premature rebate dust batch",
      },
    );
  }
  const negativeChecks = [];
  for (const call of negativeCalls) {
    negativeChecks.push(await requireExpectedRevert(client, call, snapshotBlock));
  }

  const output = {
    mode: "read-only",
    network: APP_NETWORK,
    chainId,
    rpcCount: rpcUrls.length,
    operationalBoundary: {
      transactionSent: false,
      signingMaterialLoaded: false,
      walletClientCreated: false,
      contractWriteSubmitted: false,
      outputAddressFree: true,
    },
    snapshot: {
      blockNumber: snapshotBlock.toString(),
      timestamp: block.timestamp.toString(),
    },
    tokenBoundary: {
      runtimePresent: true,
      immutableMatch: true,
      decimals: tokenDecimals,
    },
    runtimeIdentity,
    scan: {
      fromEpoch: scanFrom.toString(),
      throughEpoch: (currentEpoch - 1n).toString(),
      resolvedEpochs: resolvedEpochs.length,
      configuredMaxEpochs: MAX_SCAN_EPOCHS,
      readBatchSize: READ_BATCH_SIZE,
      complete: scanComplete,
      truncated: !scanComplete,
    },
    currentEpoch: {
      epoch: currentEpoch.toString(),
      funded: currentData[0] > 0n,
      expired: block.timestamp >= currentEndTime,
      resolveReady,
      simulationSkipped: resolveReady && !resolvePlanningReady,
      skipReason: resolveReady && !adminStateClean ? adminBlockReason : null,
      resolveEstimatedGas: resolveGas.toString(),
      recommendedResolveGasLimit: recommendedResolveGasLimit.toString(),
      expectedResolverRewardLinea: formatUnits(expectedResolverReward, 18),
      currentGasPriceWei: currentGasPrice.toString(),
      estimatedResolveFeeEth: formatUnits(estimatedResolveFee, 18),
      breakEvenEthPerLinea: formatRatio(estimatedResolveFee, expectedResolverReward),
    },
    roles: rolePlans,
    protocolFeeFlush: {
      needed: ownerFees > 0n || burnFees > 0n,
      amountLinea: formatUnits(ownerFees + burnFees, 18),
      estimatedGas: feeFlushGas.toString(),
      simulationSkipped: !claimPlanningReady && (ownerFees > 0n || burnFees > 0n),
      skipReason: claimPlanningSkipReason,
    },
    accounting: {
      scope: "lower bound; unknown resolver addresses, unscanned history, and direct token transfers remain in residual",
      historyComplete: scanComplete,
      currentEpochPoolLinea: formatUnits(currentData[0], 18),
      rolloverLinea: formatUnits(rolloverPool, 18),
      jackpotPoolsLinea: formatUnits(dailyJackpotPool + weeklyJackpotPool, 18),
      protocolFeesLinea: formatUnits(ownerFees + burnFees, 18),
      outstandingRewardLinea: formatUnits(outstandingRewardLiability, 18),
      outstandingRebateLinea: formatUnits(outstandingRebateLiability, 18),
      knownResolverRewardsLinea: formatUnits(knownResolverLiability, 18),
      lowerBoundLiabilityLinea: formatUnits(lowerBoundLiability, 18),
      contractBalanceLinea: formatUnits(contractBalance, 18),
      covered: lowerBoundCovered,
      residualOrUnscannedLinea: formatUnits(lowerBoundResidual, 18),
      deficitLinea: formatUnits(lowerBoundDeficit, 18),
    },
    dust: { rewardEpochsEligible: rewardDustEligible, rebateEpochsEligible: rebateDustEligible },
    admin: {
      clean: adminStateClean,
      ownerMatch: ownerMatches,
      feeRecipientMatch: feeRecipientMatches,
      epochDurationMatch: epochDurationMatches,
      pendingOwner: pendingOwnerChange,
      pendingEpochDuration: pendingDuration.toString(),
      pendingFeeRecipient: pendingFeeRecipientChange,
    },
    negativeCoverage: {
      applicableChecks: negativeChecks.length,
      openClaimWindowChecksApplied: Boolean(openClaimWindowEpoch),
      fundedExpiredBetCheckApplied: resolveReady,
    },
    negativeChecks,
    nextAuthorization: !adminStateClean
      ? {
          transactionLimit: 0,
          calls: [],
          estimatedGas: "0",
          rerunRequiredAfterReceipt: false,
          blockedBy: adminBlockReason ?? "governance state requires explicit review",
        }
      : resolveReady
        ? {
            transactionLimit: 1,
            calls: ["resolveEpoch(currentEpoch)"],
            estimatedGas: resolveGas.toString(),
            recommendedGasLimit: recommendedResolveGasLimit.toString(),
            rerunRequiredAfterReceipt: true,
          }
        : !scanComplete
          ? {
              transactionLimit: 0,
              calls: [],
              estimatedGas: "0",
              rerunRequiredAfterReceipt: false,
              blockedBy: "resolved-history scan is truncated; increase V10_POSTDEPLOY_SCAN_EPOCHS and rerun",
            }
          : {
              transactionLimit: claimPhaseTransactions,
              calls: claimPhaseCalls,
              estimatedGas: claimPhaseGas.toString(),
              rerunRequiredAfterReceipt: false,
            },
    currentClaimPhase: {
      complete: claimPlanningReady,
      historyComplete: scanComplete,
      skipped: !claimPlanningReady,
      skipReason: claimPlanningSkipReason,
      transactions: claimPhaseTransactions,
      estimatedGas: claimPhaseGas.toString(),
      transfersLinea: formatUnits(claimPhaseTransfers, 18),
      invalidatedByResolve: resolveReady,
    },
    totals: {
      currentlySimulatedTransactions: claimPhaseTransactions + plannedCallCount(resolvePlanningReady),
      currentlySimulatedGas: (claimPhaseGas + resolveGas).toString(),
      plannedTransfersLinea: formatUnits(claimPhaseTransfers, 18),
      contractBalanceLinea: formatUnits(contractBalance, 18),
      contractBalanceCoversPlannedTransfers: contractBalance >= claimPhaseTransfers,
    },
    next: !adminStateClean
      ? "Mutation planning is blocked until every pending governance change is explicitly reviewed and cleared."
      : resolveReady
        ? "Resolve is a separate phase; rerun this planner after its receipt before authorizing new claims."
        : !scanComplete
          ? "Claim and fee-flush authorization is blocked until the resolved-history scan is complete."
          : "The listed calls are the current-state bounded claim/flush phase.",
  };
  if (SUMMARY_ONLY) {
    const callCounts = output.nextAuthorization.calls.reduce<Record<string, number>>((counts, call) => {
      const functionName = typeof call === "string" ? call : call.functionName;
      counts[functionName] = (counts[functionName] ?? 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({
      mode: output.mode,
      network: output.network,
      chainId: output.chainId,
      rpcCount: output.rpcCount,
      operationalBoundary: output.operationalBoundary,
      snapshot: output.snapshot,
      scan: output.scan,
      currentEpoch: output.currentEpoch,
      admin: output.admin,
      accounting: {
        historyComplete: output.accounting.historyComplete,
        covered: output.accounting.covered,
        deficitLinea: output.accounting.deficitLinea,
        residualOrUnscannedLinea: output.accounting.residualOrUnscannedLinea,
        contractBalanceCoversPlannedTransfers: output.totals.contractBalanceCoversPlannedTransfers,
      },
      negativeCoverage: output.negativeCoverage,
      nextAuthorization: {
        transactionLimit: output.nextAuthorization.transactionLimit,
        estimatedGas: output.nextAuthorization.estimatedGas,
        rerunRequiredAfterReceipt: output.nextAuthorization.rerunRequiredAfterReceipt,
        blockedBy: "blockedBy" in output.nextAuthorization ? output.nextAuthorization.blockedBy : undefined,
        callCounts,
      },
      currentClaimPhase: output.currentClaimPhase,
      totals: output.totals,
      next: output.next,
    }, null, 2));
    if (!lowerBoundCovered || contractBalance < claimPhaseTransfers) process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(output, null, 2));
  if (!lowerBoundCovered || contractBalance < claimPhaseTransfers) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof SafePlanError ? error.message : `Read-only planning failed (${classifyError(error)})`;
  console.error(`[v10-postdeploy-plan] ${message}`);
  process.exitCode = 1;
});
