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
const LINEA_MAINNET_PRIORITY_FLOOR = parseGwei("0.01");
const LINEA_SEPOLIA_PRIORITY_FLOOR = parseGwei("0.04");
const LINEA_MAINNET_PRIORITY_CAP = parseGwei("0.06");
const LINEA_SEPOLIA_PRIORITY_CAP = parseGwei("0.08");
const LINEA_MAINNET_KEEPER_PRIORITY_FLOOR = parseGwei("0.02");
const LINEA_SEPOLIA_KEEPER_PRIORITY_FLOOR = parseGwei("0.05");
const LINEA_MAINNET_KEEPER_GAS_PRICE_FLOOR = parseGwei("0.05");
const LINEA_SEPOLIA_KEEPER_GAS_PRICE_FLOOR = parseGwei("0.05");

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
    return {
      gasPrice: floor,
      maxFeePerGas: floor,
      maxPriorityFeePerGas: priority,
    };
  }

  const priority = getPriorityFloor(chainId);
  const cap = getPriorityCap(chainId);
  const maxFee = cap !== undefined && cap > priority ? cap : priority;
  return {
    gasPrice: maxFee,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: priority,
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
    let maxFee = (fees.maxFeePerGas * baseBumpPercent) / ONE_HUNDRED;
    if (maxFee < MIN_PRIORITY_FEE_WEI) {
      maxFee = MIN_PRIORITY_FEE_WEI;
    }

    let priority = rawPriority > 0n
      ? (rawPriority * priorityBumpPercent) / ONE_HUNDRED
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
      gasPrice: (fees.gasPrice * baseBumpPercent) / ONE_HUNDRED,
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
      ? (rawPriority * priorityBumpPercent) / ONE_HUNDRED
      : priorityFloor;

    if (priority < priorityFloor) {
      priority = priorityFloor;
    }

    let maxFee = (fees.maxFeePerGas * maxFeeBumpPercent) / ONE_HUNDRED;
    if (maxFee < priority) {
      maxFee = priority;
    }

    return {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority,
    };
  }

  if (fees.gasPrice !== undefined) {
    let gasPrice = (fees.gasPrice * maxFeeBumpPercent) / ONE_HUNDRED;
    const floor = getKeeperGasPriceFloor(chainId);
    if (gasPrice < floor) {
      gasPrice = floor;
    }
    return { gasPrice };
  }

  return undefined;
}
