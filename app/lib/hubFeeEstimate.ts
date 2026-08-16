import { formatBalanceFixed } from "./balanceFormatting";

const CANONICAL_TILE_RE = /^(?:0|[1-9]\d*)$/;
const CANONICAL_EPOCH_RE = /^(?:0|[1-9]\d*)$/;
export const HUB_FEE_ESTIMATE_DEBOUNCE_MS = 600;

export function normalizeHubFeeEstimateTiles(selectedTilesKey: string, gridSize: number) {
  if (!Number.isSafeInteger(gridSize) || gridSize < 1 || gridSize > 32) return [];
  if (!selectedTilesKey) return [];
  return [...new Set(selectedTilesKey.split(",").flatMap((raw) => {
    if (!CANONICAL_TILE_RE.test(raw)) return [];
    const tile = Number(raw);
    return Number.isSafeInteger(tile) && tile >= 1 && tile <= gridSize ? [tile] : [];
  }))].sort((a, b) => a - b);
}

export function buildHubFeeEstimatePlan({
  requiresEpochBoundBets,
  gridDisplayEpoch,
  selectedTiles,
  amount,
}: {
  requiresEpochBoundBets: boolean;
  gridDisplayEpoch: string | null;
  selectedTiles: number[];
  amount: bigint;
}) {
  if (amount <= 0n) throw new Error("Invalid bet amount");
  if (selectedTiles.length === 0) throw new Error("No selected tiles");
  const tileMask = selectedTiles.reduce((mask, tile) => mask | (1 << (tile - 1)), 0);
  if (requiresEpochBoundBets) {
    if (!gridDisplayEpoch || !CANONICAL_EPOCH_RE.test(gridDisplayEpoch)) {
      throw new Error("Current epoch unavailable for protected bet estimate");
    }
    return {
      functionName: "placeBatchBetsBitmapForEpoch" as const,
      args: [BigInt(gridDisplayEpoch), tileMask, amount] as const,
      tileMask,
    };
  }
  if (selectedTiles.length === 1) {
    return {
      functionName: "placeBet" as const,
      args: [BigInt(selectedTiles[0]), amount] as const,
      tileMask,
    };
  }
  return {
    functionName: "placeBatchBetsBitmap" as const,
    args: [tileMask, amount] as const,
    tileMask,
  };
}

export function formatHubFeeEstimate(gas: bigint, feePerGas: bigint) {
  if (gas <= 0n || feePerGas <= 0n) throw new Error("No fee quote");
  return formatBalanceFixed({ value: gas * feePerGas, decimals: 18 }, 6) ?? "0.000000";
}

export async function collectHubFeeEstimate({
  estimateGas,
  estimateFeesPerGas,
}: {
  estimateGas: () => Promise<bigint>;
  estimateFeesPerGas: () => Promise<{
    gasPrice?: bigint | null;
    maxFeePerGas?: bigint | null;
  }>;
}) {
  const [gas, fees] = await Promise.all([estimateGas(), estimateFeesPerGas()]);
  const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (!feePerGas) throw new Error("No fee quote");
  return formatHubFeeEstimate(gas, feePerGas);
}

export function getHubFeeEstimateLabel(
  feeEstimate: string | null,
  feeEstimateUnavailable: boolean,
) {
  if (feeEstimate) return `~${feeEstimate} ETH`;
  return feeEstimateUnavailable ? "unavailable" : "calculating";
}

export function getHubReadOnlyPresentation(readOnlyReason: string | null | undefined) {
  if (!readOnlyReason) return null;
  return {
    testId: "hub-read-only-banner",
    text: readOnlyReason,
  } as const;
}
