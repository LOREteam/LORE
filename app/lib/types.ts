export type TabId = "hub" | "analytics" | "rebate" | "leaderboards" | "whitepaper" | "faq";

export interface LeaderboardEntry {
  rank: number;
  address: string;
  name?: string;
  value: string;
  valueNum: number;
  extra?: string;
}

export interface LuckyTileEntry {
  tileId: number;
  wins: number;
  pct: number;
}

export interface UnclaimedWin {
  epoch: string;
  amountWei: string;
}

export type RewardScanStatus = "idle" | "loading" | "refreshing" | "verified" | "stale" | "error";

/**
 * The trust state of rewards read from the contract. A non-null
 * `lastVerifiedAt` only comes from a completed scan for `walletAddress`; submitted or confirmed claims may invalidate it but never advance it.
 */
export interface RewardScanVerificationState {
  status: RewardScanStatus;
  walletAddress: string | null;
  lastVerifiedAt: number | null;
  /** True when the latest attempted scan had a failed or shortened multicall. */
  incomplete: boolean;
  error: string | null;
}

export interface EpochHistoryEntry {
  roundId: string;
  totalPoolWei: string;
  winningTile: string;
  isResolved: boolean;
}
