"use client";

import React, { useMemo } from "react";
import type { JackpotHistoryEntry } from "../../hooks/useJackpotHistory";
import { loadingQuotes } from "../../lib/loreTexts";
import { EXPLORER_TX_BASE_URL } from "../../lib/constants";
import { LoreText } from "../LoreText";
import { UiBadge } from "../ui/UiBadge";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";
import { UiTable, UiTableBody, UiTableHead, UiTableRow } from "../ui/UiTable";

interface AnalyticsJackpotHistoryPanelProps {
  jackpotHistory: JackpotHistoryEntry[];
  jackpotHistoryError: string | null;
  jackpotHistoryLoading: boolean;
  onRefreshJackpotHistory: () => void;
}

export const AnalyticsJackpotHistoryPanel = React.memo(function AnalyticsJackpotHistoryPanel({
  jackpotHistory,
  jackpotHistoryError,
  jackpotHistoryLoading,
  onRefreshJackpotHistory,
}: AnalyticsJackpotHistoryPanelProps) {
  const rows = useMemo(
    () =>
      jackpotHistory.map((entry, index) => ({
        key: `${entry.kind}-${entry.epoch}-${entry.txHash}-${index}`,
        kind: entry.kind,
        formattedTimestamp: entry.timestamp ? new Date(entry.timestamp).toLocaleString() : null,
        epoch: entry.epoch,
        amount: entry.amount,
        txHash: entry.txHash,
      })),
    [jackpotHistory],
  );

  return (
    <UiPanel
      tone="default"
      padding="md"
      className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
          <div className="w-1 h-4 bg-amber-400 rounded-sm shadow-[0_0_10px_rgba(251,191,36,0.45)]" />
          Jackpot History
        </h2>
        <UiButton
          onClick={onRefreshJackpotHistory}
          disabled={jackpotHistoryLoading}
          variant="ghost"
          size="xs"
          className="h-10 w-10 p-0 text-gray-500 hover:text-amber-300 hover:border-amber-500/20 hover:bg-amber-500/[0.06] active:scale-95"
          title="Refresh jackpot history"
          aria-label="Refresh jackpot history"
        >
          <svg className={`w-3.5 h-3.5 ${jackpotHistoryLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </UiButton>
      </div>

      {jackpotHistoryError ? (
        <div className="text-center py-4 flex flex-col items-center gap-2">
          <svg className="h-5 w-5 text-amber-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-[11px] text-amber-400/90">Unable to load jackpot history</span>
          <span className="text-[10px] text-gray-500">Please try refreshing in a moment.</span>
        </div>
      ) : jackpotHistory.length === 0 ? (
        <div className="text-center py-4 flex flex-col items-center gap-2">
          {jackpotHistoryLoading ? (
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider"><LoreText items={loadingQuotes} /></span>
          ) : (
            <>
              <span className="text-[11px] text-gray-400 italic">No jackpot awards yet.</span>
              <span className="text-[10px] text-gray-500">If a jackpot was awarded, the indexer may still be syncing. Use Refresh above.</span>
            </>
          )}
        </div>
      ) : (
        <UiTable tone="amber" maxHeightClass="max-h-[220px]">
          <table className="w-full text-left">
            <UiTableHead>
              <tr>
                <th className="px-3 py-2 w-[90px]">Type</th>
                <th className="px-3 py-2 w-[150px]">Date</th>
                <th className="px-3 py-2 w-[80px]">Epoch</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right w-[95px]">Tx</th>
              </tr>
            </UiTableHead>
            <UiTableBody>
              {rows.map((entry, index) => (
                <UiTableRow key={entry.key} index={index}>
                  <td className="px-3 py-2">
                    {entry.kind === "daily" ? (
                      <UiBadge tone="amber" size="xs" uppercase>
                        Daily
                      </UiBadge>
                    ) : (
                      <UiBadge tone="fuchsia" size="xs" uppercase>
                        Weekly
                      </UiBadge>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {entry.formattedTimestamp ? (
                      <span className="text-[11px] text-gray-300 font-mono truncate max-w-[150px] inline-block" title={entry.formattedTimestamp}>
                        {entry.formattedTimestamp}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-white text-sm font-semibold whitespace-nowrap">#{entry.epoch}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="font-bold text-amber-300 font-mono text-sm">{entry.amount}</span>
                    <span className="text-xs text-gray-400 ml-0.5">LINEA</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {entry.txHash ? (
                      <a
                        href={`${EXPLORER_TX_BASE_URL}/${entry.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-violet-400/60 hover:text-violet-400 transition-colors"
                      >
                        {entry.txHash.slice(0, 6)}...{entry.txHash.slice(-4)}
                      </a>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </UiTableRow>
              ))}
            </UiTableBody>
          </table>
        </UiTable>
      )}
    </UiPanel>
  );
});
