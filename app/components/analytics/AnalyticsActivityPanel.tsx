"use client";

import React from "react";
import { useUserActivityHistory, type UserActivityType } from "../../hooks/useUserActivityHistory";
import { getExplorerTxUrl } from "../../lib/explorerLinks";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";
import { UiTable, UiTableBody, UiTableHead, UiTableRow } from "../ui/UiTable";

const ACTIVITY_LABELS: Record<UserActivityType, string> = {
  bet: "Bet",
  reward_claim: "Reward claim",
  reward_batch_claim: "Reward batch",
  rebate_claim: "Rebate claim",
  rebate_batch_claim: "Rebate batch",
};

export const AnalyticsActivityPanel = React.memo(function AnalyticsActivityPanel({
  walletAddress,
}: {
  walletAddress?: string;
}) {
  const activity = useUserActivityHistory(walletAddress);
  const isStale = activity.error !== null && activity.items !== null;

  return (
    <UiPanel tone="default" padding="md" className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white">
            <span className="h-4 w-1 rounded-sm bg-emerald-500" /> Indexed activity
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">Durable bets and claims recorded by this indexer.</p>
        </div>
        {activity.address && (
          <div className="flex items-center gap-2">
            <span role="status" aria-live="polite" aria-busy={activity.loading}
              className={`text-[10px] font-bold uppercase tracking-wider ${isStale ? "text-amber-300" : activity.loading ? "text-violet-300" : "text-emerald-300"}`}>
              {isStale ? "Stale" : activity.loading ? "Loading" : "Indexed"}
            </span>
            <UiButton onClick={activity.refresh} disabled={activity.loading} variant="ghost" size="xs"
              className="h-11 min-w-11 px-2" aria-label="Refresh indexed activity">Refresh</UiButton>
          </div>
        )}
      </div>

      {!activity.address ? (
        <p className="py-3 text-center text-[11px] text-slate-400">Connect a play wallet to view its indexed activity.</p>
      ) : activity.error && activity.items === null ? (
        <div role="alert" className="py-4 text-center text-[11px] text-amber-200">
          {activity.error} No activity is shown until a verified response is available.
        </div>
      ) : activity.items === null ? (
        <div role="status" aria-live="polite" aria-busy="true" className="space-y-2 py-2">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-10 animate-pulse rounded bg-white/5" />)}
        </div>
      ) : (
        <>
          <div className="mb-2 rounded border border-amber-400/20 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-100">
            Partial coverage: this durable ledger starts when indexer support is enabled. Older chain activity is not backfilled.
            {activity.indexedThroughBlock !== "0" && ` Indexed through block ${activity.indexedThroughBlock}.`}
          </div>
          {isStale && <div role="alert" className="mb-2 text-[10px] text-amber-200">Refresh failed. Showing the last verified indexed activity.</div>}
          {activity.items.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-slate-400">No activity has been indexed for this wallet yet.</p>
          ) : (
            <UiTable aria-label="Indexed wallet activity" tone="violet" maxHeightClass="max-h-[260px]">
              <table className="w-full text-left">
                <UiTableHead><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Epoch</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Tx</th></tr></UiTableHead>
                <UiTableBody>{activity.items.map((row, index) => {
                  const txUrl = getExplorerTxUrl(row.txHash);
                  return <UiTableRow key={row.eventId} index={index}>
                    <td className="px-3 py-2 text-[11px] text-white">{ACTIVITY_LABELS[row.activityType]}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-300">{row.epoch ? `#${row.epoch}` : "Multiple"}</td>
                    <td className="px-3 py-2 text-right font-mono text-[11px] text-emerald-300">{row.amount} LINEA</td>
                    <td className="px-3 py-2 text-right">{txUrl ? <a href={txUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-violet-300 hover:text-violet-200" aria-label={`Open transaction ${row.txHash} in explorer`}>{row.txHash.slice(0, 6)}...{row.txHash.slice(-4)}</a> : "-"}</td>
                  </UiTableRow>;
                })}</UiTableBody>
              </table>
            </UiTable>
          )}
          {activity.hasMore && <UiButton onClick={activity.loadMore} disabled={activity.loading} variant="ghost" size="xs" fullWidth className="mt-2 min-h-11">Load older indexed activity</UiButton>}
        </>
      )}
    </UiPanel>
  );
});
