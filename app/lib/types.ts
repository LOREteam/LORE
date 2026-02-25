export type TabId = "hub" | "analytics" | "referral" | "leaderboards" | "whitepaper" | "faq";

export interface LeaderboardEntry {
  rank: number;
  address: string;
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

export interface EpochHistoryEntry {
  roundId: string;
  totalPoolWei: string;
  winningTile: string;
  isResolved: boolean;
}
