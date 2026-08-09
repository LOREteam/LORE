import { formatUnits, parseUnits } from "viem";

export function parseLineaAmountWei(value: string | undefined) {
  if (!value) return 0n;
  try {
    return parseUnits(value, 18);
  } catch {
    return 0n;
  }
}

export function parsePositiveLineaAmountWei(value: string | undefined) {
  const amountWei = parseLineaAmountWei(value);
  return amountWei > 0n ? amountWei : null;
}

export function parsePositiveLineaAmountWeiOrFallback(value: string | undefined, fallbackValue: string) {
  return parsePositiveLineaAmountWei(value) ?? parsePositiveLineaAmountWei(fallbackValue) ?? 1_000_000_000_000_000_000n;
}

export function formatLineaAmountFixed(wei: bigint, fractionDigits = 2) {
  const safeFractionDigits = Math.max(0, Math.min(18, Math.trunc(fractionDigits)));
  const precision = 10n ** BigInt(safeFractionDigits);
  const roundingScale = 10n ** BigInt(18 - safeFractionDigits);
  const rounded = (wei + (roundingScale / 2n)) / roundingScale;
  const whole = rounded / precision;
  const fraction = rounded % precision;

  if (safeFractionDigits === 0) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction.toString().padStart(safeFractionDigits, "0")}`;
}

export function parseNonNegativeLineaWei(value: string | bigint | null | undefined) {
  if (typeof value === "bigint") return value >= 0n ? value : 0n;
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return 0n;
  return BigInt(trimmed);
}

function addDecimalGroupSeparators(value: string) {
  const [whole, fraction] = value.split(".");
  const groupedWhole = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? groupedWhole : `${groupedWhole}.${fraction}`;
}

export function formatLineaWeiAmountDisplay(value: string | bigint | null | undefined, fractionDigits = 2) {
  const safeFractionDigits = Math.max(0, Math.min(18, Math.trunc(fractionDigits)));
  try {
    return addDecimalGroupSeparators(formatLineaAmountFixed(parseNonNegativeLineaWei(value), safeFractionDigits));
  } catch {
    return safeFractionDigits > 0 ? `0.${"0".repeat(safeFractionDigits)}` : "0";
  }
}

export function formatLineaWeiDisplayNumber(value: bigint): number {
  if (value <= 0n) return 0;
  const scale = 1_000_000_000_000n;
  const scaled = (value + (scale / 2n)) / scale;
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(scaled) / 1_000_000;
}

export function normalizeTileAmounts(
  tileIds: number[],
  amounts: string[] | undefined,
  totalAmount: string,
) {
  if (tileIds.length === 0) {
    return { tileIds: [], amounts: [] };
  }

  const normalizedAmounts =
    Array.isArray(amounts) && amounts.length === tileIds.length
      ? amounts.map((value) => parseLineaAmountWei(value))
      : tileIds.map(() => parseLineaAmountWei(totalAmount) / BigInt(tileIds.length));

  const aggregate = new Map<number, bigint>();
  for (let index = 0; index < tileIds.length; index += 1) {
    const tileId = Number(tileIds[index]);
    if (!Number.isInteger(tileId) || tileId <= 0 || tileId > 25) continue;
    aggregate.set(tileId, (aggregate.get(tileId) ?? 0n) + (normalizedAmounts[index] ?? 0n));
  }

  return {
    tileIds: [...aggregate.keys()],
    amounts: [...aggregate.values()].map((value) => formatUnits(value, 18)),
  };
}

export function computeWinningAmountWei(
  tileIds: number[],
  amounts: string[] | undefined,
  winningTile: number,
  totalAmount: string,
) {
  if (!Number.isInteger(winningTile) || winningTile <= 0) return 0n;
  if (tileIds.length === 0) return 0n;

  if (Array.isArray(amounts) && amounts.length === tileIds.length) {
    return tileIds.reduce((sum, tileId, index) => {
      if (Number(tileId) !== winningTile) return sum;
      return sum + parseLineaAmountWei(amounts[index]);
    }, 0n);
  }

  const hitCount = tileIds.reduce((count, tileId) => count + (Number(tileId) === winningTile ? 1 : 0), 0);
  if (hitCount <= 0) return 0n;
  const totalWei = parseLineaAmountWei(totalAmount);
  if (totalWei <= 0n) return 0n;
  return (totalWei * BigInt(hitCount)) / BigInt(tileIds.length);
}
