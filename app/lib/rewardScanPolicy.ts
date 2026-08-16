import type { UnclaimedWin } from "./types";

export const AUTOMATIC_REWARD_SCAN_DEPTH = 5_000n;
export const FAST_REWARD_SCAN_DEPTH = 1_500n;
export const REWARD_CLAIM_WINDOW_SECONDS = 365n * 24n * 60n * 60n;

type RewardReadResult = { result?: unknown } | undefined;

export type PotentialRewardWin = {
  id: bigint;
  rewardPool: bigint;
};

export function getAutomaticRewardScanBounds(actualCurrentEpoch: bigint) {
  const startEpoch = actualCurrentEpoch > 1n ? actualCurrentEpoch - 1n : 0n;
  const minEpoch = actualCurrentEpoch > AUTOMATIC_REWARD_SCAN_DEPTH
    ? actualCurrentEpoch - AUTOMATIC_REWARD_SCAN_DEPTH
    : 1n;
  const fastFloor = actualCurrentEpoch > FAST_REWARD_SCAN_DEPTH
    ? actualCurrentEpoch - FAST_REWARD_SCAN_DEPTH
    : 1n;
  const quickMinEpoch = fastFloor > minEpoch ? fastFloor : minEpoch;
  return { startEpoch, minEpoch, quickMinEpoch };
}

export function* iterateDescendingRewardScanEpochChunks(
  rangeStart: bigint,
  rangeMin: bigint,
  chunkSize: bigint,
): Generator<bigint[]> {
  if (chunkSize <= 0n) throw new RangeError("reward scan chunk size must be positive");
  let cursor = rangeStart;
  while (cursor >= rangeMin) {
    const end = cursor - chunkSize + 1n < rangeMin
      ? rangeMin
      : cursor - chunkSize + 1n;
    const epochIds: bigint[] = [];
    for (let epoch = cursor; epoch >= end; epoch -= 1n) epochIds.push(epoch);
    yield epochIds;
    cursor = end - 1n;
  }
}

export function chunkRewardScanItems<T>(items: readonly T[], chunkSize: number): T[][] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError("reward scan item chunk size must be a positive safe integer");
  }
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    chunks.push(items.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function isRewardClaimWindowOpen(resolvedAt: bigint, chainTimestamp: bigint): boolean {
  return resolvedAt === 0n || chainTimestamp < resolvedAt + REWARD_CLAIM_WINDOW_SECONDS;
}

export function collectOpenRewardScanWins({
  potentialWins,
  betResults,
  tilePoolResults,
  resolvedAtResults,
  chainTimestamp,
}: {
  potentialWins: readonly PotentialRewardWin[];
  betResults: readonly RewardReadResult[];
  tilePoolResults: readonly RewardReadResult[];
  resolvedAtResults: readonly RewardReadResult[];
  chainTimestamp: bigint;
}): UnclaimedWin[] {
  const wins: UnclaimedWin[] = [];
  potentialWins.forEach((win, index) => {
    const betAmount = betResults[index]?.result;
    const tileTotal = tilePoolResults[index]?.result;
    const resolvedAt = resolvedAtResults[index]?.result;
    if (
      typeof betAmount !== "bigint" || betAmount <= 0n
      || typeof tileTotal !== "bigint" || tileTotal <= 0n
      || typeof resolvedAt !== "bigint"
      || !isRewardClaimWindowOpen(resolvedAt, chainTimestamp)
    ) {
      return;
    }
    const amountWei = (win.rewardPool * betAmount) / tileTotal;
    if (amountWei <= 0n) return;
    wins.push({ epoch: win.id.toString(), amountWei: amountWei.toString() });
  });
  return wins;
}
