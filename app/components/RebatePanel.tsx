"use client";

import React from "react";
import { UiButton } from "./ui/UiButton";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

interface RebatePanelProps {
  address?: string;
  rebateInfo: {
    isSupported?: boolean;
    pendingRebate: string;
    pendingRebateWei: bigint;
    claimableEpochs: number;
    totalEpochs: number;
    isLoading?: boolean;
    hasLoaded?: boolean;
    dataFreshness?: "fresh" | "background-refresh" | "stale-cache" | "offline";
    claimPlanKind?: "none" | "single" | "split" | "unknown";
    isEstimatingClaimPlan?: boolean;
    minClaimAmount?: string;
    isBelowClaimMinimum?: boolean;
    recentEpochs: Array<{
      epoch: number;
      pending: string;
      pendingWei: bigint;
      claimed: boolean;
      resolved: boolean;
    }>;
  } | null;
  isClaiming: boolean;
  onClaimRebates: () => Promise<void>;
}

function formatRebateAmount(value: string | null | undefined): string {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "0.0000";
}

export const RebatePanel = React.memo(function RebatePanel({
  address,
  rebateInfo,
  isClaiming,
  onClaimRebates,
}: RebatePanelProps) {
  const isSupported = rebateInfo?.isSupported ?? true;
  const hasClaimable = (rebateInfo?.claimableEpochs ?? 0) > 0;
  const isLoading = rebateInfo?.isLoading ?? false;
  const hasLoaded = rebateInfo?.hasLoaded ?? false;
  const hasPendingOnly = (rebateInfo?.pendingRebateWei ?? 0n) > 0n && !hasClaimable;
  const claimPlanKind = rebateInfo?.claimPlanKind ?? "none";
  const isEstimatingClaimPlan = rebateInfo?.isEstimatingClaimPlan ?? false;
  const minClaimAmount = rebateInfo?.minClaimAmount ?? "100";
  const isBelowClaimMinimum = rebateInfo?.isBelowClaimMinimum ?? false;
  const showInitialSkeleton = isLoading && !hasLoaded;
  const freshnessMessage =
    rebateInfo?.dataFreshness === "offline"
      ? "Showing last loaded Safety Pool data. Refresh failed and will retry automatically."
      : rebateInfo?.dataFreshness === "stale-cache"
        ? "Showing cached Safety Pool data while the ledger refreshes."
        : rebateInfo?.dataFreshness === "background-refresh"
          ? "Safety Pool refresh is already in progress; current data remains visible."
          : null;

  return (
    <div className="flex-1 overflow-y-auto pb-12 animate-fade-in">
      <div className="max-w-2xl mx-auto px-4 md:px-8 pt-6">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 mb-4 animate-slide-up">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-synced-pulse" />
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Safety Pool</span>
          </div>
          <h1 className="text-2xl font-black text-white mb-2 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            Safety Pool
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed animate-slide-up" style={{ animationDelay: "0.1s" }}>
            Every resolved epoch saves <span className="text-emerald-400 font-bold">1%</span> of the pool for players
            who participated but missed the winning tile.
          </p>
        </div>

        <UiPanel tone="success" className="mb-4 animate-slide-up" style={{ animationDelay: "0.15s" }}>
          <h2 className={`${uiTokens.sectionLabel} text-white mb-3`}>Your Safety Pool balance</h2>
          {!address ? (
            <p className="text-sm text-gray-500 text-center py-4">Connect your wallet to load Safety Pool history.</p>
          ) : showInitialSkeleton ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
                  <div className="mb-2 h-2.5 w-14 rounded-full bg-white/10" />
                  <div className="h-8 w-36 rounded-full bg-emerald-500/10" />
                </div>
                <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3">
                  <div className="mb-2 h-2.5 w-20 rounded-full bg-white/10" />
                  <div className="h-8 w-14 rounded-full bg-sky-500/10" />
                </div>
              </div>
              <div className="rounded-xl border border-white/6 bg-white/3 px-4 py-3 text-center text-sm text-gray-500">
                Loading Safety Pool ledger...
              </div>
            </div>
          ) : !isSupported ? (
            <p className="text-sm text-gray-500 text-center py-4">
              Safety Pool functions are disabled for the configured contract profile.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Pending</div>
                  <div className="lore-nums text-xl font-black text-emerald-400">
                    {formatRebateAmount(rebateInfo?.pendingRebate)} LINEA
                  </div>
                </div>
                <div>
                  <div className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Claimable epochs</div>
                  <div className="lore-nums text-xl font-black text-sky-400">
                    {rebateInfo?.claimableEpochs ?? 0}
                  </div>
                </div>
              </div>
              <UiButton
                onClick={onClaimRebates}
                loading={isClaiming}
                disabled={!hasClaimable || !isSupported || isBelowClaimMinimum}
                variant="success"
                size="md"
                uppercase
                fullWidth
                className="text-xs"
              >
                {isClaiming
                  ? "Claiming..."
                  : isBelowClaimMinimum
                    ? "Below minimum"
                    : hasClaimable
                      ? "Claim Safety Pool"
                      : "Nothing to claim"}
              </UiButton>
              {hasClaimable && isBelowClaimMinimum ? (
                <p className="mt-3 text-xs leading-relaxed text-gray-500">
                  Current Safety Pool is below the {minClaimAmount} LINEA minimum. Wait for more claimable epochs before paying gas.
                </p>
              ) : null}
              {hasPendingOnly ? (
                <p className="mt-3 text-xs leading-relaxed text-gray-500">
                  Pending Safety Pool includes unresolved or not-yet-claimable epochs. Claim unlocks only after those epochs are resolved.
                </p>
              ) : null}
              {isLoading && hasLoaded ? (
                <p className="mt-3 text-xs leading-relaxed text-gray-500">
                  Refreshing Safety Pool ledger in background...
                </p>
              ) : null}
              {freshnessMessage ? (
                <p
                  data-testid="rebate-freshness-hint"
                  className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-100/75"
                >
                  {freshnessMessage}
                </p>
              ) : null}
              {hasClaimable ? (
                <p className="mt-3 text-xs leading-relaxed text-gray-500">
                  {isEstimatingClaimPlan
                    ? "Estimating whether the current Safety Pool set fits in one transaction..."
                    : claimPlanKind === "single"
                      ? "Current Safety Pool set should fit in one batched transaction. This is usually much cheaper than claiming epochs one by one."
                      : claimPlanKind === "split"
                        ? "Current Safety Pool set looks too large for a single reliable claim, so the wallet may split it into multiple transactions."
                        : "Claim size depends on the current epoch set and network conditions; the app will try one batched transaction first."}
                </p>
              ) : null}
            </>
          )}
        </UiPanel>

        <div className="grid grid-cols-2 gap-3 mb-4 animate-slide-up" style={{ animationDelay: "0.2s" }}>
          <StatBox label="Epochs participated" value={String(rebateInfo?.totalEpochs ?? 0)} accent="violet" />
          <StatBox label="Claimable now" value={String(rebateInfo?.claimableEpochs ?? 0)} accent="emerald" />
        </div>

        <UiPanel tone="default" className="animate-slide-up" style={{ animationDelay: "0.25s" }}>
          <h2 className={`${uiTokens.sectionLabel} text-white mb-3`}>Recent Safety Pool epochs</h2>
          {showInitialSkeleton ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/20 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 h-2.5 w-20 rounded-full bg-white/10" />
                    <div className="h-4 w-28 rounded-full bg-white/6" />
                  </div>
                  <div className="h-3 w-16 rounded-full bg-white/6" />
                </div>
              ))}
            </div>
          ) : !rebateInfo?.recentEpochs?.length ? (
            <p className="text-sm text-gray-500">
              {isSupported
                ? rebateInfo?.totalEpochs
                  ? "Recent Safety Pool rows are still being indexed or there is nothing claimable yet."
                  : "No Safety Pool history yet."
                : "Safety Pool history is unavailable on the current contract."}
            </p>
          ) : (
            <div className="space-y-2">
              {rebateInfo.recentEpochs.map((row) => (
                <div key={row.epoch} className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-black/20 px-3 py-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Epoch #{row.epoch}</div>
                    <div className="text-sm font-bold text-white">
                      {row.resolved ? (
                        <span className="lore-nums">{formatRebateAmount(row.pending)} LINEA</span>
                      ) : (
                        "Pending resolve"
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-[10px] font-bold uppercase tracking-widest ${row.claimed ? "text-gray-500" : row.pendingWei > 0 ? "text-emerald-400" : "text-gray-400"}`}>
                      {row.claimed ? "Claimed" : row.pendingWei > 0 ? "Claimable" : row.resolved ? "No Safety Pool" : "Live"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </UiPanel>
      </div>
    </div>
  );
});

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    violet: "border-violet-500/25 text-violet-400 bg-violet-500/4",
    emerald: "border-emerald-500/25 text-emerald-400 bg-emerald-500/4",
    sky: "border-sky-500/25 text-sky-400 bg-sky-500/4",
  };

  return (
    <div className={`p-3 border ${uiTokens.radius.md} ${colors[accent]}`}>
      <div className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mb-1">{label}</div>
      <div className="lore-nums text-lg font-black">{value}</div>
    </div>
  );
}
