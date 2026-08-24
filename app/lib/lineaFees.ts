import { parseEther, parseGwei } from "viem";

type FeeEstimate = {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
};

export type FeeOverrides = {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
};

export function hasCompleteFeeOverrides(overrides: FeeOverrides | undefined) {
  if (!overrides) return false;
  return overrides.gasPrice !== undefined || (
    overrides.maxFeePerGas !== undefined && overrides.maxPriorityFeePerGas !== undefined
  );
}

export function mergeFeeOverrides(
  base: FeeOverrides | undefined,
  overrides: FeeOverrides | undefined,
): FeeOverrides | undefined {
  if (!overrides) return base;
  if (hasCompleteFeeOverrides(overrides)) return { ...overrides };
  return { ...base, ...overrides };
}

export type KeeperFeeBudgetKind = "approval" | "keeper";

export type KeeperDailyBudgetPolicy = {
  maxSignatures: number;
  maxReservedCostWei: bigint;
};

export type LineaTransactionFeePolicyCaps = {
  maxApprovalCostPerTransactionWei: bigint;
  maxKeeperCostPerTransactionWei: bigint;
  maxNormalCostPerTransactionWei: bigint;
};

type FeeFieldPolicy = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxGasPrice: bigint;
};

type KeeperFeePolicy = FeeFieldPolicy & {
  maxApprovalCostWei: bigint;
  maxKeeperCostWei: bigint;
};

type NormalFeePolicy = FeeFieldPolicy & {
  maxCostWei: bigint;
};

const ONE_HUNDRED = 100n;
const MIN_PRIORITY_FEE_WEI = 1n;

/** Ceiling division for bigint: rounds up so fee bumps never under-pay. */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}
const LINEA_MAINNET_PRIORITY_FLOOR = parseGwei("0.01");
const LINEA_SEPOLIA_PRIORITY_FLOOR = parseGwei("0.04");
const LINEA_MAINNET_PRIORITY_CAP = parseGwei("0.06");
const LINEA_SEPOLIA_PRIORITY_CAP = parseGwei("0.08");
const LINEA_MAINNET_KEEPER_PRIORITY_FLOOR = parseGwei("0.02");
const LINEA_MAINNET_CHAIN_ID = 59144;
const LINEA_SEPOLIA_CHAIN_ID = 59141;
// Sepolia keeper must stay operable even with a very small faucet balance.
// Public fee estimators often return tiny values here, so a high hard floor
// can block epoch resolution entirely despite the network accepting the tx.
const LINEA_SEPOLIA_KEEPER_PRIORITY_FLOOR = parseGwei("0.001");
const LINEA_MAINNET_KEEPER_GAS_PRICE_FLOOR = parseGwei("0.05");
const LINEA_SEPOLIA_KEEPER_GAS_PRICE_FLOOR = parseGwei("0.001");
// The keeper is a fallback for stranded funded rounds, not the primary epoch
// advancement path. One signature per hour on average is a deliberately
// conservative hard ceiling; the cumulative ceiling below is stricter and is
// sourced from the existing per-transaction keeper maximum for each chain.
export const DEFAULT_KEEPER_DAILY_MAX_SIGNATURES = 24;
// These are absolute safety ceilings, not target fees. They deliberately leave
// ample headroom over the normal Linea floors while bounding a compromised RPC.
const LINEA_MAINNET_KEEPER_FEE_POLICY: KeeperFeePolicy = {
  maxFeePerGas: parseGwei("1"),
  maxPriorityFeePerGas: parseGwei("0.2"),
  maxGasPrice: parseGwei("1"),
  maxApprovalCostWei: parseEther("0.0001"),
  maxKeeperCostWei: parseEther("0.001"),
};
const LINEA_SEPOLIA_KEEPER_FEE_POLICY: KeeperFeePolicy = {
  maxFeePerGas: parseGwei("2"),
  maxPriorityFeePerGas: parseGwei("0.25"),
  maxGasPrice: parseGwei("2"),
  maxApprovalCostWei: parseEther("0.0002"),
  maxKeeperCostWei: parseEther("0.002"),
};
const LINEA_MAINNET_NORMAL_FEE_POLICY: NormalFeePolicy = {
  maxFeePerGas: parseGwei("1"),
  maxPriorityFeePerGas: LINEA_MAINNET_PRIORITY_CAP,
  maxGasPrice: parseGwei("1"),
  maxCostWei: parseEther("0.002"),
};
const LINEA_SEPOLIA_NORMAL_FEE_POLICY: NormalFeePolicy = {
  maxFeePerGas: parseGwei("2"),
  maxPriorityFeePerGas: LINEA_SEPOLIA_PRIORITY_CAP,
  maxGasPrice: parseGwei("2"),
  maxCostWei: parseEther("0.004"),
};

function feePolicyError(message: string) {
  const error = new Error(message);
  error.name = "LineaFeePolicyError";
  return error;
}

export function isLineaFeePolicyError(error: unknown): error is Error {
  return error instanceof Error && error.name === "LineaFeePolicyError";
}

function supportsEip1559Fallback(chainId?: number) {
  return chainId === LINEA_MAINNET_CHAIN_ID || chainId === LINEA_SEPOLIA_CHAIN_ID;
}

function getPriorityCap(chainId?: number) {
  if (chainId === LINEA_MAINNET_CHAIN_ID) return LINEA_MAINNET_PRIORITY_CAP;
  if (chainId === LINEA_SEPOLIA_CHAIN_ID) return LINEA_SEPOLIA_PRIORITY_CAP;
  return undefined;
}
function getPriorityFloor(chainId?: number) {
  if (chainId === LINEA_MAINNET_CHAIN_ID) return LINEA_MAINNET_PRIORITY_FLOOR;
  if (chainId === LINEA_SEPOLIA_CHAIN_ID) return LINEA_SEPOLIA_PRIORITY_FLOOR;
  return MIN_PRIORITY_FEE_WEI;
}

function getKeeperPriorityFloor(chainId?: number) {
  if (chainId === LINEA_MAINNET_CHAIN_ID) return LINEA_MAINNET_KEEPER_PRIORITY_FLOOR;
  if (chainId === LINEA_SEPOLIA_CHAIN_ID) return LINEA_SEPOLIA_KEEPER_PRIORITY_FLOOR;
  return MIN_PRIORITY_FEE_WEI;
}

function getKeeperGasPriceFloor(chainId?: number) {
  if (chainId === LINEA_MAINNET_CHAIN_ID) return LINEA_MAINNET_KEEPER_GAS_PRICE_FLOOR;
  if (chainId === LINEA_SEPOLIA_CHAIN_ID) return LINEA_SEPOLIA_KEEPER_GAS_PRICE_FLOOR;
  return MIN_PRIORITY_FEE_WEI;
}

function getKeeperFeePolicy(chainId?: number): KeeperFeePolicy {
  if (chainId === LINEA_MAINNET_CHAIN_ID) return LINEA_MAINNET_KEEPER_FEE_POLICY;
  if (chainId === LINEA_SEPOLIA_CHAIN_ID) return LINEA_SEPOLIA_KEEPER_FEE_POLICY;
  throw feePolicyError(`linea_fee_policy_unsupported_chain chainId=${String(chainId ?? "missing")}`);
}

function parseTightenedPositiveInteger(
  field: string,
  raw: string | undefined,
  maximum: number,
) {
  if (raw === undefined) return maximum;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw feePolicyError(
      `linea_fee_policy_invalid_daily_limit field=${field} expected=positive canonical integer`,
    );
  }
  const value = BigInt(raw);
  if (value > BigInt(maximum)) {
    throw feePolicyError(
      `linea_fee_policy_daily_limit_cannot_exceed_default field=${field}; limit cannot exceed repository default`,
    );
  }
  return Number(value);
}

function parseTightenedPositiveBigInt(
  field: string,
  raw: string | undefined,
  maximum: bigint,
) {
  if (raw === undefined) return maximum;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw feePolicyError(
      `linea_fee_policy_invalid_daily_limit field=${field} expected=positive canonical integer`,
    );
  }
  const value = BigInt(raw);
  if (value > maximum) {
    throw feePolicyError(
      `linea_fee_policy_daily_limit_cannot_exceed_default field=${field}; limit cannot exceed repository default`,
    );
  }
  return value;
}

export function getKeeperDailyBudgetPolicy(
  chainId: number | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): KeeperDailyBudgetPolicy {
  const perTransactionPolicy = getKeeperFeePolicy(chainId);
  return {
    maxSignatures: parseTightenedPositiveInteger(
      "KEEPER_DAILY_MAX_SIGNATURES",
      environment.KEEPER_DAILY_MAX_SIGNATURES,
      DEFAULT_KEEPER_DAILY_MAX_SIGNATURES,
    ),
    maxReservedCostWei: parseTightenedPositiveBigInt(
      "KEEPER_DAILY_MAX_RESERVED_COST_WEI",
      environment.KEEPER_DAILY_MAX_RESERVED_COST_WEI,
      perTransactionPolicy.maxKeeperCostWei,
    ),
  };
}

function getNormalFeePolicy(chainId?: number): NormalFeePolicy {
  if (chainId === LINEA_MAINNET_CHAIN_ID) return LINEA_MAINNET_NORMAL_FEE_POLICY;
  if (chainId === LINEA_SEPOLIA_CHAIN_ID) return LINEA_SEPOLIA_NORMAL_FEE_POLICY;
  throw feePolicyError(`linea_fee_policy_unsupported_chain chainId=${String(chainId ?? "missing")}`);
}

export function getLineaTransactionFeePolicyCaps(
  chainId?: number,
): LineaTransactionFeePolicyCaps {
  const keeperPolicy = getKeeperFeePolicy(chainId);
  const normalPolicy = getNormalFeePolicy(chainId);
  return {
    maxApprovalCostPerTransactionWei: keeperPolicy.maxApprovalCostWei,
    maxKeeperCostPerTransactionWei: keeperPolicy.maxKeeperCostWei,
    maxNormalCostPerTransactionWei: normalPolicy.maxCostWei,
  };
}

function assertFeeFieldsWithinPolicy(
  feeOverrides: FeeOverrides | undefined,
  chainId: number | undefined,
  policy: FeeFieldPolicy,
): asserts feeOverrides is FeeOverrides {
  if (!feeOverrides) {
    throw feePolicyError("linea_fee_policy_missing_overrides");
  }

  const hasLegacyFee = feeOverrides.gasPrice !== undefined;
  const hasEip1559Fee =
    feeOverrides.maxFeePerGas !== undefined || feeOverrides.maxPriorityFeePerGas !== undefined;
  if (hasLegacyFee && hasEip1559Fee) {
    throw feePolicyError("linea_fee_policy_mixed_fee_fields");
  }

  if (feeOverrides.gasPrice !== undefined) {
    if (feeOverrides.gasPrice <= 0n || feeOverrides.gasPrice > policy.maxGasPrice) {
      throw feePolicyError(`linea_fee_field_cap_exceeded field=gasPrice chainId=${String(chainId)}`);
    }
    return;
  }

  const maxFeePerGas = feeOverrides.maxFeePerGas;
  const maxPriorityFeePerGas = feeOverrides.maxPriorityFeePerGas;
  if (maxFeePerGas === undefined || maxPriorityFeePerGas === undefined) {
    throw feePolicyError("linea_fee_policy_incomplete_eip1559_fields");
  }
  if (maxFeePerGas <= 0n || maxFeePerGas > policy.maxFeePerGas) {
    throw feePolicyError(`linea_fee_field_cap_exceeded field=maxFeePerGas chainId=${String(chainId)}`);
  }
  if (
    maxPriorityFeePerGas <= 0n ||
    maxPriorityFeePerGas > policy.maxPriorityFeePerGas
  ) {
    throw feePolicyError(`linea_fee_field_cap_exceeded field=maxPriorityFeePerGas chainId=${String(chainId)}`);
  }
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw feePolicyError("linea_fee_policy_priority_exceeds_max_fee");
  }
}

function assertKeeperFeeFieldsWithinPolicy(
  feeOverrides: FeeOverrides | undefined,
  chainId?: number,
): asserts feeOverrides is FeeOverrides {
  assertFeeFieldsWithinPolicy(feeOverrides, chainId, getKeeperFeePolicy(chainId));
}

export function assertNormalFeeBudget(
  feeOverrides: FeeOverrides | undefined,
  gasLimit: bigint | undefined,
  chainId?: number,
): bigint {
  const policy = getNormalFeePolicy(chainId);
  assertFeeFieldsWithinPolicy(feeOverrides, chainId, policy);
  if (gasLimit === undefined) {
    throw feePolicyError("linea_fee_policy_missing_gas_limit");
  }
  if (gasLimit <= 0n) {
    throw feePolicyError("linea_fee_policy_invalid_gas_limit");
  }

  const feePerGas = feeOverrides.gasPrice ?? feeOverrides.maxFeePerGas;
  if (feePerGas === undefined) {
    throw feePolicyError("linea_fee_policy_missing_effective_fee");
  }
  const maximumCostWei = gasLimit * feePerGas;
  if (maximumCostWei > policy.maxCostWei) {
    throw feePolicyError(`linea_fee_total_cap_exceeded kind=normal chainId=${String(chainId)}`);
  }
  return maximumCostWei;
}

export function assertKeeperFeeBudget(
  feeOverrides: FeeOverrides | undefined,
  gasLimit: bigint,
  chainId: number | undefined,
  kind: KeeperFeeBudgetKind,
): bigint {
  assertKeeperFeeFieldsWithinPolicy(feeOverrides, chainId);
  if (gasLimit <= 0n) {
    throw feePolicyError("linea_fee_policy_invalid_gas_limit");
  }

  const policy = getKeeperFeePolicy(chainId);
  const feePerGas = feeOverrides.gasPrice ?? feeOverrides.maxFeePerGas;
  if (feePerGas === undefined) {
    throw feePolicyError("linea_fee_policy_missing_effective_fee");
  }
  const maximumCostWei = gasLimit * feePerGas;
  const maximumBudgetWei =
    kind === "approval" ? policy.maxApprovalCostWei : policy.maxKeeperCostWei;
  if (maximumCostWei > maximumBudgetWei) {
    throw feePolicyError(`linea_fee_total_cap_exceeded kind=${kind} chainId=${String(chainId)}`);
  }
  return maximumCostWei;
}

export function getFallbackFeeOverrides(
  chainId?: number,
  mode: "normal" | "keeper" = "normal",
): FeeOverrides {
  if (mode === "keeper") {
    const floor = getKeeperGasPriceFloor(chainId);
    const priority = getKeeperPriorityFloor(chainId);
    if (supportsEip1559Fallback(chainId)) {
      return {
        maxFeePerGas: floor,
        maxPriorityFeePerGas: priority,
      };
    }
    return {
      gasPrice: floor,
    };
  }

  const priority = getPriorityFloor(chainId);
  const cap = getPriorityCap(chainId);
  const maxFee = cap !== undefined && cap > priority ? cap : priority;
  if (supportsEip1559Fallback(chainId)) {
    return {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
    };
  }
  return {
    gasPrice: maxFee,
  };
}

export function getLineaFeeOverrides(
  fees: FeeEstimate | null | undefined,
  chainId?: number,
  baseBumpPercent = 102n,
  priorityBumpPercent = 100n,
): FeeOverrides | undefined {
  if (!fees) return undefined;

  const priorityCap = getPriorityCap(chainId);
  const priorityFloor = getPriorityFloor(chainId);
  if (fees.maxFeePerGas !== undefined) {
    const rawPriority = fees.maxPriorityFeePerGas ?? 0n;
    let maxFee = ceilDiv(fees.maxFeePerGas * baseBumpPercent, ONE_HUNDRED);
    if (maxFee < MIN_PRIORITY_FEE_WEI) {
      maxFee = MIN_PRIORITY_FEE_WEI;
    }

    let priority = rawPriority > 0n
      ? ceilDiv(rawPriority * priorityBumpPercent, ONE_HUNDRED)
      : priorityFloor;

    if (priority < priorityFloor) {
      priority = priorityFloor;
    }
    if (priorityCap !== undefined && priority > priorityCap) {
      priority = priorityCap;
    }
    if (priority > maxFee) {
      priority = maxFee;
    }
    return {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
    };
  }

  if (fees.gasPrice !== undefined) {
    return {
      gasPrice: ceilDiv(fees.gasPrice * baseBumpPercent, ONE_HUNDRED),
    };
  }

  return undefined;
}
export function getKeeperFeeOverrides(
  fees: FeeEstimate | null | undefined,
  chainId?: number,
  maxFeeBumpPercent = 130n,
  priorityBumpPercent = 125n,
): FeeOverrides | undefined {
  if (!fees) return undefined;
  if (maxFeeBumpPercent <= 0n || priorityBumpPercent <= 0n) {
    throw feePolicyError("linea_fee_policy_invalid_bump");
  }

  const priorityFloor = getKeeperPriorityFloor(chainId);
  if (fees.maxFeePerGas !== undefined) {
    const rawPriority = fees.maxPriorityFeePerGas ?? 0n;
    let priority = rawPriority > 0n
      ? ceilDiv(rawPriority * priorityBumpPercent, ONE_HUNDRED)
      : priorityFloor;

    if (priority < priorityFloor) {
      priority = priorityFloor;
    }

    let maxFee = ceilDiv(fees.maxFeePerGas * maxFeeBumpPercent, ONE_HUNDRED);
    if (maxFee < priority) {
      maxFee = priority;
    }

    const feeOverrides = {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
    };
    assertKeeperFeeFieldsWithinPolicy(feeOverrides, chainId);
    return feeOverrides;
  }

  if (fees.gasPrice !== undefined) {
    let gasPrice = ceilDiv(fees.gasPrice * maxFeeBumpPercent, ONE_HUNDRED);
    const floor = getKeeperGasPriceFloor(chainId);
    if (gasPrice < floor) {
      gasPrice = floor;
    }
    const feeOverrides = { gasPrice };
    assertKeeperFeeFieldsWithinPolicy(feeOverrides, chainId);
    return feeOverrides;
  }

  return undefined;
}
