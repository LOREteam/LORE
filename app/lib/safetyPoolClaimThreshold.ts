import { formatUnits, parseUnits } from "viem";

const DEFAULT_MIN_SAFETY_POOL_CLAIM_LINEA = "100";

export function parseMinSafetyPoolClaimWei(raw?: string | null): bigint {
  const value = raw?.trim() || DEFAULT_MIN_SAFETY_POOL_CLAIM_LINEA;
  try {
    return parseUnits(value, 18);
  } catch {
    return parseUnits(DEFAULT_MIN_SAFETY_POOL_CLAIM_LINEA, 18);
  }
}

export function isSafetyPoolClaimBelowMinimum(amountWei: bigint, minWei: bigint): boolean {
  return amountWei > 0n && minWei > 0n && amountWei < minWei;
}

export function formatSafetyPoolClaimMinimum(minWei: bigint): string {
  return formatUnits(minWei, 18);
}

export const MIN_SAFETY_POOL_CLAIM_WEI = parseMinSafetyPoolClaimWei(
  process.env.NEXT_PUBLIC_MIN_SAFETY_POOL_CLAIM_LINEA,
);

export const MIN_SAFETY_POOL_CLAIM_FORMATTED = formatSafetyPoolClaimMinimum(MIN_SAFETY_POOL_CLAIM_WEI);
