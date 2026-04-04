import { parseGwei } from "viem";
import { linea, lineaSepolia } from "viem/chains";

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
// Sepolia keeper must stay operable even with a very small faucet balance.
// Public fee estimators often return tiny values here, so a high hard floor
// can block epoch resolution entirely despite the network accepting the tx.
const LINEA_SEPOLIA_KEEPER_PRIORITY_FLOOR = parseGwei("0.001");
const LINEA_MAINNET_KEEPER_GAS_PRICE_FLOOR = parseGwei("0.05");
const LINEA_SEPOLIA_KEEPER_GAS_PRICE_FLOOR = parseGwei("0.001");

function supportsEip1559Fallback(chainId?: number) {
  return chainId === linea.id || chainId === lineaSepolia.id;
}

function getPriorityCap(chainId?: number) {
  if (chainId === linea.id) return LINEA_MAINNET_PRIORITY_CAP;
  if (chainId === lineaSepolia.id) return LINEA_SEPOLIA_PRIORITY_CAP;
  return undefined;
}

function getPriorityFloor(chainId?: number) {
  if (chainId === linea.id) return LINEA_MAINNET_PRIORITY_FLOOR;
  if (chainId === lineaSepolia.id) return LINEA_SEPOLIA_PRIORITY_FLOOR;
  return MIN_PRIORITY_FEE_WEI;
}

function getKeeperPriorityFloor(chainId?: number) {
  if (chainId === linea.id) return LINEA_MAINNET_KEEPER_PRIORITY_FLOOR;
  if (chainId === lineaSepolia.id) return LINEA_SEPOLIA_KEEPER_PRIORITY_FLOOR;
  return MIN_PRIORITY_FEE_WEI;
}

function getKeeperGasPriceFloor(chainId?: number) {
  if (chainId === linea.id) return LINEA_MAINNET_KEEPER_GAS_PRICE_FLOOR;
  if (chainId === lineaSepolia.id) return LINEA_SEPOLIA_KEEPER_GAS_PRICE_FLOOR;
  return MIN_PRIORITY_FEE_WEI;
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

    return {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
    };
  }

  if (fees.gasPrice !== undefined) {
    let gasPrice = ceilDiv(fees.gasPrice * maxFeeBumpPercent, ONE_HUNDRED);
    const floor = getKeeperGasPriceFloor(chainId);
    if (gasPrice < floor) {
      gasPrice = floor;
    }
    return { gasPrice };
  }

  return undefined;
}

export function getAffordableKeeperGasLimit(
  estimatedGas: bigint,
  balanceWei: bigint,
  feeOverrides: FeeOverrides | undefined,
  preferredBufferPercent = 150n,
) {
  const effectiveGasPrice = feeOverrides?.gasPrice ?? feeOverrides?.maxFeePerGas;
  if (!effectiveGasPrice || effectiveGasPrice <= 0n) {
    return (estimatedGas * preferredBufferPercent) / ONE_HUNDRED;
  }

  const candidates = [
    preferredBufferPercent,
    130n,
    120n,
    110n,
    105n,
    100n,
  ];

  for (const percent of candidates) {
    const gasLimit = (estimatedGas * percent + (ONE_HUNDRED - 1n)) / ONE_HUNDRED;
    if (gasLimit * effectiveGasPrice <= balanceWei) {
      return gasLimit;
    }
  }

  return null;
}

export function clampKeeperFeeOverridesToBalance(
  feeOverrides: FeeOverrides | undefined,
  estimatedGas: bigint,
  balanceWei: bigint,
  headroomPercent = 98n,
): FeeOverrides | undefined {
  if (!feeOverrides || estimatedGas <= 0n || balanceWei <= 0n) return feeOverrides;

  const affordablePerGas = ((balanceWei * headroomPercent) / ONE_HUNDRED) / estimatedGas;
  if (affordablePerGas <= 0n) return feeOverrides;

  if (feeOverrides.gasPrice !== undefined) {
    if (feeOverrides.gasPrice <= affordablePerGas) return feeOverrides;
    return { gasPrice: affordablePerGas };
  }

  if (feeOverrides.maxFeePerGas !== undefined) {
    const maxFeePerGas =
      feeOverrides.maxFeePerGas <= affordablePerGas
        ? feeOverrides.maxFeePerGas
        : affordablePerGas;
    const maxPriorityFeePerGas =
      feeOverrides.maxPriorityFeePerGas === undefined
        ? maxFeePerGas
        : feeOverrides.maxPriorityFeePerGas <= maxFeePerGas
          ? feeOverrides.maxPriorityFeePerGas
          : maxFeePerGas;

    return {
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  }

  return feeOverrides;
}
