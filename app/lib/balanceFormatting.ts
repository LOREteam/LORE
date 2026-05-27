import { formatUnits } from "viem";

export type WagmiBalanceLike = {
  decimals?: number;
  formatted?: string;
  value: bigint;
} | null | undefined;

export function getFormattedBalance(balance: WagmiBalanceLike, fallbackDecimals = 18) {
  if (!balance) return null;
  if (typeof balance.formatted === "string") return balance.formatted;
  return formatUnits(balance.value, balance.decimals ?? fallbackDecimals);
}
