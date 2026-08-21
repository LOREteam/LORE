"use client";

import React from "react";
import { UiBadge } from "../ui/UiBadge";
import { UiPanel } from "../ui/UiPanel";
import { UiTable, UiTableBody, UiTableHead, UiTableRow } from "../ui/UiTable";
import { GRID_SIZE } from "../../lib/constants";

interface HistoryViewRow {
  roundId: string;
  poolDisplay: string;
  winningTile: string;
  isResolved: boolean;
  userWon: boolean;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
}

interface AnalyticsBlockchainHistoryPanelProps {
  historyViewData: HistoryViewRow[];
  historyError: string | null;
  historyLoading: boolean;
  historyRefreshing: boolean;
  newHistoryIds: Set<string>;
}

function parseHistoryWinningTile(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const tile = Number(value);
  return Number.isSafeInteger(tile) && tile >= 1 && tile <= GRID_SIZE ? tile : null;
}

export const AnalyticsBlockchainHistoryPanel = React.memo(function AnalyticsBlockchainHistoryPanel({
  historyViewData,
  historyError,
  historyLoading,
  historyRefreshing,
  newHistoryIds,
}: AnalyticsBlockchainHistoryPanelProps) {
  return (
    <UiPanel
      tone="default"
      padding="md"
      className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
          <div className="w-1 h-4 bg-violet-500 rounded-sm shadow-[0_0_10px_rgba(139,92,246,0.4)]" />
          Blockchain History
        </h2>
        {(historyError || historyLoading || historyViewData.length > 0) && (
          <span
            role="status"
            aria-live="polite"
            aria-busy={historyRefreshing || historyLoading}
            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${historyError ? "text-amber-300" : historyRefreshing || historyLoading ? "text-violet-300" : "text-gray-300"}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${historyError ? "bg-amber-400" : historyRefreshing || historyLoading ? "bg-violet-400 animate-synced-pulse" : "bg-emerald-400/80"}`} />
            {historyError ? "Stale" : historyRefreshing || historyLoading ? "Refreshing" : "Ready"}
          </span>
        )}
      </div>

      {historyError && historyViewData.length === 0 ? (
        <div role="alert" className="flex flex-col items-center justify-center gap-2 py-4 text-center">
          <svg className="h-5 w-5 text-amber-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-[11px] text-amber-400/90">Unable to load blockchain history</span>
          <span className="text-[10px] text-gray-400">Please refresh in a moment. Previously verified rounds remain visible when available.</span>
        </div>
      ) : (
        <>
          {historyError && (
            <div role="alert" className="mb-2 rounded-md border border-amber-400/20 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-200">
              Refresh failed. Showing the last verified blockchain history.
            </div>
          )}
          {historyLoading && historyViewData.length === 0 ? (
        <div role="status" aria-live="polite" aria-busy="true" className="space-y-1.5 py-2">
          <div className="flex items-center gap-2 mb-3">
            <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-synced-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300">Loading rounds...</span>
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md bg-white/2 px-3 py-2.5">
              <div className="h-4 w-12 animate-pulse rounded bg-white/6" />
              <div className="h-5 w-14 animate-pulse rounded-full bg-emerald-500/10" />
              <div className="h-4 w-20 animate-pulse rounded bg-white/6" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-white/4" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-white/6" />
            </div>
          ))}
        </div>
          ) : historyViewData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
          <div className="mb-2 text-2xl opacity-30">⛏</div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-300">No rounds yet</p>
          <p className="mt-1 text-[10px] text-gray-400">Place your first bet to start mining the Lattice</p>
        </div>
          ) : (
        <UiTable aria-label="Blockchain history" tone="violet" maxHeightClass="max-h-[260px]">
          <table className="w-full text-left">
            <UiTableHead>
              <tr>
                <th className="px-3 py-2">Round</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Winner</th>
                <th className="px-3 py-2">Bonus</th>
                <th className="px-3 py-2 text-right">Pool</th>
              </tr>
            </UiTableHead>
            <UiTableBody>
              {historyViewData.map((row, index) => {
                const winningTile = parseHistoryWinningTile(row.winningTile);
                const isNew = newHistoryIds.has(row.roundId);
                const userWonDailyJackpot = row.userWon && row.isDailyJackpot;
                const userWonWeeklyJackpot = row.userWon && row.isWeeklyJackpot;
                const userWonDualJackpot = userWonDailyJackpot && userWonWeeklyJackpot;
                return (
                  <UiTableRow key={row.roundId} index={index} isNew={isNew}>
                    <td className="px-3 py-2 font-mono text-white text-sm font-semibold">#{row.roundId}</td>
                    <td className="px-3 py-2">
                      {row.isResolved ? (
                        <UiBadge tone="success" size="xs" uppercase dot>
                          Done
                        </UiBadge>
                      ) : (
                        <UiBadge tone="warning" size="xs" uppercase dot pulseDot>
                          Pending
                        </UiBadge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.isResolved && winningTile !== null ? (
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white">Block #{winningTile}</span>
                          {row.userWon && (
                            <UiBadge tone="amber" size="xs" uppercase>
                              <span className="text-amber-300">*</span> You won
                            </UiBadge>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {userWonDualJackpot ? (
                        <UiBadge tone="violet" size="xs" uppercase>
                          Daily + Weekly
                        </UiBadge>
                      ) : userWonDailyJackpot ? (
                        <UiBadge tone="amber" size="xs" uppercase>
                          Daily
                        </UiBadge>
                      ) : userWonWeeklyJackpot ? (
                        <UiBadge tone="sky" size="xs" uppercase>
                          Weekly
                        </UiBadge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-bold text-violet-300 font-mono text-sm">{row.poolDisplay}</span>
                      <span className="text-[11px] text-gray-300 ml-1">LINEA</span>
                    </td>
                  </UiTableRow>
                );
              })}
            </UiTableBody>
          </table>
        </UiTable>
          )}
        </>
      )}
    </UiPanel>
  );
});
