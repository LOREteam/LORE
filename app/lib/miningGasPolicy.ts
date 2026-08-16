const WEI_PER_ETH = 10n ** 18n;
const SIX_DECIMAL_SCALE = 1_000_000n;
const MINING_GAS_BUFFER_PERCENT = 180n;

export function formatNativeWeiSixDecimals(rawValue: bigint): string {
  const value = rawValue < 0n ? 0n : rawValue;
  const whole = value / WEI_PER_ETH;
  const remainder = value % WEI_PER_ETH;
  const roundedFraction = (remainder * SIX_DECIMAL_SCALE + WEI_PER_ETH / 2n) / WEI_PER_ETH;
  if (roundedFraction >= SIX_DECIMAL_SCALE) {
    return `${whole + 1n}.000000`;
  }
  return `${whole}.${roundedFraction.toString().padStart(6, "0")}`;
}

export function assertSufficientNativeGasBalance(balance: bigint, requiredCost: bigint): void {
  if (balance >= requiredCost) return;
  const have = formatNativeWeiSixDecimals(balance);
  const need = formatNativeWeiSixDecimals(requiredCost);
  throw new Error(`Not enough ETH for gas: need ~${need} ETH, have ${have} ETH.`);
}

export function getBufferedMiningGasLimit(
  baselineGas: bigint,
  minimumGas: bigint,
  bufferExtra: bigint,
): bigint {
  const bufferedGas = (baselineGas * MINING_GAS_BUFFER_PERCENT) / 100n + bufferExtra;
  return bufferedGas > minimumGas ? bufferedGas : minimumGas;
}
