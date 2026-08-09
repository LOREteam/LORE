export type EpochCoverageSummary = {
  missingCount: number;
  latestStoredEpoch: number | null;
  highestContiguousEpoch: number;
  missingLatest: number[];
};

const MISSING_EPOCH_SAMPLE_LIMIT = 20;

export function summarizeEpochCoverage(
  presentEpochs: ReadonlySet<number>,
  maxEpochToCheck: number,
): EpochCoverageSummary {
  if (!Number.isSafeInteger(maxEpochToCheck) || maxEpochToCheck < 0) {
    throw new RangeError("maxEpochToCheck must be a non-negative safe integer");
  }

  const sortedPresentEpochs = [...presentEpochs]
    .filter((epoch) => Number.isSafeInteger(epoch) && epoch > 0 && epoch <= maxEpochToCheck)
    .sort((left, right) => left - right);
  const normalizedPresentEpochs = new Set(sortedPresentEpochs);
  const missingCount = Math.max(0, maxEpochToCheck - normalizedPresentEpochs.size);
  const latestStoredEpoch = sortedPresentEpochs.at(-1) ?? null;

  let highestContiguousEpoch = 0;
  for (const epoch of sortedPresentEpochs) {
    if (epoch !== highestContiguousEpoch + 1) break;
    highestContiguousEpoch = epoch;
  }

  const missingLatestDescending: number[] = [];
  for (
    let epoch = maxEpochToCheck;
    epoch > 0 && missingLatestDescending.length < MISSING_EPOCH_SAMPLE_LIMIT;
    epoch -= 1
  ) {
    if (!normalizedPresentEpochs.has(epoch)) missingLatestDescending.push(epoch);
  }

  return {
    missingCount,
    latestStoredEpoch,
    highestContiguousEpoch,
    missingLatest: missingLatestDescending.reverse(),
  };
}
