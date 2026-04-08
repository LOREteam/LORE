"use client";

import React, { useMemo } from "react";
import type { DepositEntry } from "../../hooks/useDepositHistory";
import { loadingQuotes, emptyStates } from "../../lib/loreTexts";
import { EXPLORER_TX_BASE_URL } from "../../lib/constants";
import { LoreText } from "../LoreText";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";
import { UiTable, UiTableBody, UiTableHead, UiTableRow } from "../ui/UiTable";

interface AnalyticsDepositsPanelProps {
  deposits: DepositEntry[] | null;
  depositsError: string | null;
  depositsLoading: boolean;
  depositsRefreshing: boolean;
  newDepositIds: Set<string>;
  onLoadDeposits: () => void;
  onRefreshDeposits: () => void;
  showMore: () => void;
  totalDeposited: number;
  visibleCount: number;
  visibleDeposits: DepositEntry[];
  hasMore: boolean;
}

export const AnalyticsDepositsPanel = React.memo(function AnalyticsDepositsPanel({
  deposits,
  depositsError,
  depositsLoading,
  depositsRefreshing,
  newDepositIds,
  onLoadDeposits,
  onRefreshDeposits,
  showMore,
  totalDeposited,
  visibleCount,
  visibleDeposits,
  hasMore,
}: AnalyticsDepositsPanelProps) {
  const visibleRows = useMemo(
    () =>
      visibleDeposits.map((deposit, index) => {
        const userWon = deposit.winningTile !== null && deposit.tileIds.includes(deposit.winningTile);
        return {
          key: deposit.txHash || `${deposit.epoch}-${index}`,
          epoch: deposit.epoch,
          sortedTileIds: [...deposit.tileIds].sort((left, right) => left - right),
          winningTile: deposit.winningTile,
          userWon,
          wonDailyJackpot:
            Boolean(deposit.isDailyJackpot) && userWon,
          wonWeeklyJackpot:
            Boolean(deposit.isWeeklyJackpot) && userWon,
          amount: deposit.amount,
          reward: deposit.reward,
          txHash: deposit.txHash,
          isNew: deposit.txHash ? newDepositIds.has(deposit.txHash) : false,
        };
      }),
    [newDepositIds, visibleDeposits],
  );

  return (
    <UiPanel
      tone="default"
      padding="md"
      className="shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_20px_rgba(139,92,246,0.06)] px-4 py-2.5"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 uppercase tracking-wider">
          <div className="w-1 h-4 bg-sky-500 rounded-sm shadow-[0_0_10px_rgba(14,165,233,0.4)]" />
          My Deposits
        </h2>
        <div className="flex items-center gap-3">
          {deposits !== null && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${depositsRefreshing ? "text-sky-300" : "text-gray-500"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${depositsRefreshing ? "bg-sky-400 animate-synced-pulse" : "bg-emerald-400/80"}`} />
              {depositsRefreshing ? "Refreshing" : "Ready"}
            </span>
          )}
          {deposits && deposits.length > 0 && (
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              Total: <span className="text-sky-400">{totalDeposited.toFixed(2)} LINEA</span>
              <span className="text-gray-400 ml-1.5">({deposits.length} tx)</span>
            </span>
          )}
          <UiButton
            onClick={onRefreshDeposits}
            disabled={depositsLoading}
            variant="ghost"
            size="xs"
            className="h-10 w-10 p-0 text-gray-500 hover:text-sky-300 hover:border-sky-500/20 hover:bg-sky-500/[0.06] active:scale-95"
            title="Refresh"
            aria-label="Refresh deposits"
          >
            <svg className={`w-3.5 h-3.5 ${depositsLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </UiButton>
        </div>
      </div>

      {depositsError ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <svg className="h-5 w-5 text-amber-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-[11px] text-amber-400/90">Unable to load deposit history</span>
          <span className="text-[10px] text-gray-500">Please try refreshing in a moment. If the issue persists, the server may need attention.</span>
        </div>
      ) : deposits === null && !depositsLoading ? (
        <div className="flex flex-col items-center justify-center py-3 gap-2">
          <span className="text-[12px] text-gray-500">Scans full chain history for your bets (cached incrementally)</span>
          <UiButton
            onClick={onLoadDeposits}
            disabled={depositsLoading}
            variant="sky"
            size="sm"
            uppercase
          >
            {depositsLoading ? <LoreText items={loadingQuotes} /> : "Load History"}
          </UiButton>
        </div>
      ) : deposits === null && depositsLoading ? (
        <div className="space-y-1.5 py-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-synced-pulse" />
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider"><LoreText items={loadingQuotes} /></span>
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-md bg-white/[0.02] px-3 py-2.5" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="h-4 w-12 animate-pulse rounded bg-white/[0.06]" />
              <div className="flex gap-1">
                <div className="h-6 w-6 animate-pulse rounded bg-violet-500/10" />
                <div className="h-6 w-6 animate-pulse rounded bg-violet-500/10" />
              </div>
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-4 w-14 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      ) : deposits && deposits.length === 0 ? (
        <div className="text-center py-4 flex flex-col items-center gap-2">
          <span className="text-[11px] text-gray-400 italic"><LoreText items={emptyStates.analytics} /></span>
          <span className="text-[10px] text-gray-500">If you&apos;ve already placed bets, use <strong className="text-sky-400/90">Refresh</strong> above to load history.</span>
        </div>
      ) : (
        <>
          <UiTable tone="sky" maxHeightClass="max-h-[260px]">
            <table className="w-full text-left">
              <UiTableHead>
                <tr>
                  <th className="px-3 py-2 w-[70px]">Epoch</th>
                  <th className="px-3 py-2">Tiles</th>
                  <th className="px-3 py-2 text-right w-[110px]">Amount</th>
                  <th className="px-3 py-2 text-right w-[90px]">Tx</th>
                </tr>
              </UiTableHead>
              <UiTableBody>
                {visibleRows.map((row, index) => {
                  const hasJackpotBadge = row.wonDailyJackpot || row.wonWeeklyJackpot;
                  const isDualJackpot = row.wonDailyJackpot && row.wonWeeklyJackpot;
                  return (
                    <UiTableRow key={row.key} index={index} isNew={row.isNew}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-mono text-sm font-semibold text-white">#{row.epoch}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {row.sortedTileIds.map((tileId, tileIndex) => {
                            const isWinner = row.winningTile !== null && tileId === row.winningTile;
                            const winnerClass = row.wonDailyJackpot && row.wonWeeklyJackpot
                              ? "bg-gradient-to-br from-amber-500/25 to-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/45 shadow-[0_0_10px_rgba(217,70,239,0.24)]"
                              : row.wonDailyJackpot
                                ? "bg-amber-500/20 text-amber-300 border-amber-400/45 shadow-[0_0_8px_rgba(245,158,11,0.28)]"
                                : row.wonWeeklyJackpot
                                  ? "bg-sky-500/18 text-sky-300 border-sky-400/45 shadow-[0_0_8px_rgba(56,189,248,0.24)]"
                                  : "bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-[0_0_6px_rgba(245,158,11,0.3)]";
                            return (
                              <span
                                key={`${tileId}-${tileIndex}`}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold border ${
                                  isWinner
                                    ? winnerClass
                                    : "bg-violet-500/10 text-violet-400 border-violet-500/20"
                                }`}
                              >
                                {tileId}
                              </span>
                            );
                          })}
                          {hasJackpotBadge && (
                            <span
                              className={`ml-1 inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-black uppercase leading-none tracking-[0.16em] whitespace-nowrap ${
                                isDualJackpot
                                  ? "border-fuchsia-400/30 bg-gradient-to-r from-amber-500/12 to-fuchsia-500/12 text-fuchsia-300"
                                  : row.wonDailyJackpot
                                    ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                                    : "border-sky-400/30 bg-sky-500/10 text-sky-300"
                              }`}
                            >
                              {isDualJackpot ? "Dual Jackpot" : row.wonDailyJackpot ? "Daily Jackpot" : "Weekly Jackpot"}
                            </span>
                          )}
                          {/* Regular win badge (non-jackpot) */}
                          {row.userWon && !hasJackpotBadge && (
                            <span className="ml-1 inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase leading-none tracking-[0.14em] whitespace-nowrap text-emerald-300">
                              Win
                            </span>
                          )}
                          {/* Reward amount for any win */}
                          {row.userWon && typeof row.reward === "number" && row.reward > 0 && (
                            <span className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase leading-none tracking-[0.12em] whitespace-nowrap text-emerald-300">
                              +{row.reward.toFixed(2)} LINEA
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span className="font-bold text-sky-400 font-mono text-sm">{row.amount}</span>
                        <span className="text-xs text-gray-400 ml-0.5">LINEA</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {row.txHash ? (
                          <a
                            href={`${EXPLORER_TX_BASE_URL}/${row.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-violet-400/60 hover:text-violet-400 transition-colors"
                          >
                            {row.txHash.slice(0, 6)}...{row.txHash.slice(-4)}
                          </a>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </UiTableRow>
                  );
                })}
              </UiTableBody>
            </table>
          </UiTable>
          {hasMore && deposits && (
            <UiButton
              onClick={showMore}
              variant="ghost"
              size="xs"
              fullWidth
              uppercase
              className="mt-2 text-gray-400 hover:text-gray-300"
            >
              Show more ({deposits.length - visibleCount} remaining)
            </UiButton>
          )}
        </>
      )}
    </UiPanel>
  );
});
