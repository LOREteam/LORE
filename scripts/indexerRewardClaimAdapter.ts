import type { RewardClaimStorageRow } from "../server/storage";

export interface IndexedRewardClaim {
  id: string;
  epoch: string;
  user: string;
  reward: string;
  rewardNum: number;
  txHash: string;
  blockNumber: string;
  /** A batch aggregate owns the durable user-activity row for this tx. */
  recordUserActivity?: boolean;
}

/**
 * Keep the indexer-to-storage boundary explicit and directly testable without
 * importing the indexer's networked entrypoint. Raw per-epoch claims remain
 * available to read models even when their activity projection is suppressed.
 */
export function toRewardClaimStorageRows(
  records: readonly IndexedRewardClaim[],
): RewardClaimStorageRow[] {
  return records.map((row) => ({
    id: row.id,
    epoch: row.epoch,
    user: row.user,
    reward: row.reward,
    rewardNum: row.rewardNum,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    recordUserActivity: row.recordUserActivity,
  }));
}