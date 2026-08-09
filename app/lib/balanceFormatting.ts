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

export function formatScaledUnitsFixed(scaled: bigint, fractionDigits: number): string {
  if (fractionDigits <= 0) return scaled.toString();
  const padded = scaled.toString().padStart(fractionDigits + 1, "0");
  const whole = padded.slice(0, -fractionDigits) || "0";
  const fractional = padded.slice(-fractionDigits);
  return `${whole}.${fractional}`;
}

export function formatDecimalTextFixed(text: string, fractionDigits: number): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [wholeRaw, fractionalRaw = ""] = text.split(".");
  const keep = fractionalRaw.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  const nextDigit = fractionalRaw[fractionDigits];
  const scaledText = `${wholeRaw}${keep}`.replace(/^0+(?=\d)/, "") || "0";
  let scaled = BigInt(scaledText);
  if (nextDigit && nextDigit >= "5") scaled += 1n;
  return formatScaledUnitsFixed(scaled, fractionDigits);
}

export function normalizeBalanceDecimals(balance: WagmiBalanceLike, fallbackDecimals = 18): number | null {
  if (!balance) return null;
  const decimals = balance.decimals ?? fallbackDecimals;
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null;
}

export function formatBalanceFixed(balance: WagmiBalanceLike, fractionDigits: number, fallbackDecimals = 18): string | null {
  if (!balance || typeof balance.value !== "bigint" || balance.value < 0n) return null;
  const decimals = normalizeBalanceDecimals(balance, fallbackDecimals);
  if (decimals === null) return null;
  if (decimals >= fractionDigits) {
    const divisor = 10n ** BigInt(decimals - fractionDigits);
    let scaled = balance.value / divisor;
    const remainder = balance.value % divisor;
    if (remainder * 2n >= divisor) scaled += 1n;
    return formatScaledUnitsFixed(scaled, fractionDigits);
  }
  return formatScaledUnitsFixed(balance.value * 10n ** BigInt(fractionDigits - decimals), fractionDigits);
}
