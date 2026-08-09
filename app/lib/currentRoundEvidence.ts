export interface CurrentRoundEvidence {
  /** Epoch identity that binds the pool and end-time evidence. */
  currentEpoch: bigint | null;
  /** Exact current-epoch total pool from the authoritative epoch tuple. */
  currentEpochTotalPoolWei: bigint | null;
  /** Canonical current-epoch Unix end time in seconds. */
  effectiveEpochEndTime: bigint | null;
}

export interface DeriveCurrentRoundEvidenceInput {
  currentEpoch: unknown;
  currentEpochData: unknown;
  effectiveEpochEndTime: unknown;
}

function positiveBigIntOrNull(value: unknown): bigint | null {
  return typeof value === "bigint" && value > 0n ? value : null;
}

function exactEpochPoolWeiOrNull(value: unknown): bigint | null {
  if (!Array.isArray(value) || value.length < 6) return null;
  const [poolWei, rewardPool, winningTile, resolved, dailyJackpot, weeklyJackpot] = value;
  if (
    typeof poolWei !== "bigint" ||
    poolWei < 0n ||
    typeof rewardPool !== "bigint" ||
    typeof winningTile !== "bigint" ||
    typeof resolved !== "boolean" ||
    typeof dailyJackpot !== "boolean" ||
    typeof weeklyJackpot !== "boolean"
  ) {
    return null;
  }
  return poolWei;
}

export function deriveCurrentRoundEvidence({
  currentEpoch,
  currentEpochData,
  effectiveEpochEndTime,
}: DeriveCurrentRoundEvidenceInput): CurrentRoundEvidence {
  const boundEpoch = positiveBigIntOrNull(currentEpoch);
  if (boundEpoch === null) {
    return {
      currentEpoch: null,
      currentEpochTotalPoolWei: null,
      effectiveEpochEndTime: null,
    };
  }

  return {
    currentEpoch: boundEpoch,
    currentEpochTotalPoolWei: exactEpochPoolWeiOrNull(currentEpochData),
    effectiveEpochEndTime: positiveBigIntOrNull(effectiveEpochEndTime),
  };
}
