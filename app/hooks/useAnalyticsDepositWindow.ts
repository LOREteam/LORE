"use client";

import { useCallback, useMemo, useState } from "react";
import type { DepositEntry } from "./useDepositHistory";

const PAGE_SIZE = 50;

export function useAnalyticsDepositWindow(deposits: DepositEntry[] | null) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visibleDeposits = useMemo(
    () => deposits?.slice(0, visibleCount),
    [deposits, visibleCount],
  );

  const hasMore = deposits !== null && visibleCount < deposits.length;

  const showMore = useCallback(() => {
    setVisibleCount((current) => current + PAGE_SIZE);
  }, []);

  return {
    visibleCount,
    visibleDeposits,
    hasMore,
    showMore,
    pageSize: PAGE_SIZE,
  };
}
