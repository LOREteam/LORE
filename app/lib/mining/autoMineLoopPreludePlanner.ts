export type AutoMineLoopPreludeOperation = "refresh-session" | "await-epoch-ready";

export interface AutoMineLoopPreludeDecision {
  operations: AutoMineLoopPreludeOperation[];
}

export function planAutoMineLoopPrelude(params: {
  hasRefreshSession: boolean;
  lastPlacedEpoch: bigint | null;
  lastSessionRefresh: number;
  now: number;
  sessionRefreshIntervalMs: number;
}): AutoMineLoopPreludeDecision {
  const operations: AutoMineLoopPreludeOperation[] = [];

  if (
    params.hasRefreshSession &&
    params.now - params.lastSessionRefresh > params.sessionRefreshIntervalMs
  ) {
    operations.push("refresh-session");
  }

  if (params.lastPlacedEpoch !== null) {
    operations.push("await-epoch-ready");
  }

  return {
    operations,
  };
}
