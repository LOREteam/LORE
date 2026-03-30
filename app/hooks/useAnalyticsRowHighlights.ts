"use client";

import { useEffect, useMemo, useRef } from "react";
import type { DepositEntry } from "./useDepositHistory";

interface HistoryRow {
  roundId: string;
}

export function useAnalyticsRowHighlights(
  historyViewData: HistoryRow[],
  deposits: DepositEntry[] | null,
) {
  const seenHistoryRef = useRef<Set<string>>(new Set());
  const historyInitRef = useRef(false);
  const seenDepositsRef = useRef<Set<string>>(new Set());
  const depositsInitRef = useRef(false);

  const newHistoryIds = useMemo(() => {
    if (!historyInitRef.current) return new Set<string>();
    const next = new Set<string>();
    for (const row of historyViewData) {
      if (!seenHistoryRef.current.has(row.roundId)) next.add(row.roundId);
    }
    return next;
  }, [historyViewData]);

  useEffect(() => {
    if (historyViewData.length === 0) return;
    historyInitRef.current = true;
    for (const row of historyViewData) seenHistoryRef.current.add(row.roundId);
  }, [historyViewData]);

  const newDepositIds = useMemo(() => {
    if (!depositsInitRef.current || !deposits) return new Set<string>();
    const next = new Set<string>();
    for (const deposit of deposits) {
      if (deposit.txHash && !seenDepositsRef.current.has(deposit.txHash)) next.add(deposit.txHash);
    }
    return next;
  }, [deposits]);

  useEffect(() => {
    if (!deposits || deposits.length === 0) return;
    depositsInitRef.current = true;
    for (const deposit of deposits) {
      if (deposit.txHash) seenDepositsRef.current.add(deposit.txHash);
    }
  }, [deposits]);

  return {
    newHistoryIds,
    newDepositIds,
  };
}
