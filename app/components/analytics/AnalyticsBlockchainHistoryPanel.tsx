"use client";

import React from "react";
import { UiBadge } from "../ui/UiBadge";
import { UiPanel } from "../ui/UiPanel";
import { UiTable, UiTableBody, UiTableHead, UiTableRow } from "../ui/UiTable";

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
  historyLoading: boolean;
  historyRefreshing: boolean;
  newHistoryIds: Set<string>;
}

export const AnalyticsBlockchainHistoryPanel = React.memo(function AnalyticsBlockchainHistoryPanel({
  historyViewData,
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
        {(historyLoading || historyViewData.length > 0) && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${historyRefreshing || historyLoading ? "text-violet-300" : "text-gray-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${historyRefreshing || historyLoading ? "bg-violet-400 animate-synced-pulse" : "bg-emerald-400/80"}`} />
            {historyRefreshing || historyLoading ? "Refreshing" : "Ready"}
          </span>
        )}
      </div>

      {historyLoading && historyViewData.length === 0 ? (
        <div className="space-y-1.5 py-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-synced-pulse" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300">Loading rounds...</span>
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md bg-white/[0.02] px-3 py-2.5">
              <div className="h-4 w-12 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-5 w-14 animate-pulse rounded-full bg-emerald-500/10" />
              <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-white/[0.04]" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-white/[0.06]" />
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
        <UiTable tone="violet" maxHeightClass="max-h-[260px]">
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
                const winBlockNum = Number(row.winningTile);
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
                      {row.isResolved && winBlockNum > 0 ? (
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white">Block #{row.winningTile}</span>
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
                      <span className="font-bold text-violet-400 font-mono text-sm">{row.poolDisplay}</span>
                      <span className="text-[11px] text-gray-400 ml-1">LINEA</span>
                    </td>
                  </UiTableRow>
                );
              })}
            </UiTableBody>
          </table>
        </UiTable>
      )}
    </UiPanel>
  );
});
