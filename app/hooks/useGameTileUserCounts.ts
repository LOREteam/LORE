"use client";

import { useEffect, useState } from "react";
import { createZeroTileUserCounts } from "./useGameData.helpers";

interface UseGameTileUserCountsOptions {
  gridDisplayEpochBigInt: bigint | null;
  liveGrid: boolean;
  serverStateMatchesGrid: boolean;
  fallbackTileUserCounts?: number[] | null;
}

export function useGameTileUserCounts({
  gridDisplayEpochBigInt,
  liveGrid,
  serverStateMatchesGrid,
  fallbackTileUserCounts,
}: UseGameTileUserCountsOptions) {
  const [tileUserCounts, setTileUserCounts] = useState<number[]>(() => createZeroTileUserCounts());

  useEffect(() => {
    if (!gridDisplayEpochBigInt) {
      setTileUserCounts(createZeroTileUserCounts());
      return;
    }
    if (!liveGrid || !serverStateMatchesGrid || !fallbackTileUserCounts) {
      setTileUserCounts(createZeroTileUserCounts());
      return;
    }
    setTileUserCounts(fallbackTileUserCounts);
  }, [fallbackTileUserCounts, gridDisplayEpochBigInt, liveGrid, serverStateMatchesGrid]);

  return {
    tileUserCounts,
    setTileUserCounts,
  };
}
