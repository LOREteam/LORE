"use client";

import React from "react";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";
import type { PendingTransactionStatus } from "../../hooks/useWalletActions";

interface WalletSettingsPendingTxPanelProps {
  pendingTransactionStatus: PendingTransactionStatus | null;
  isRefreshingPendingTx: boolean;
  isCancellingPendingTx: boolean;
  onRefreshPendingTx: () => void;
  onCancelPendingTx: () => void;
}

export const WalletSettingsPendingTxPanel = React.memo(function WalletSettingsPendingTxPanel({
  pendingTransactionStatus,
  isRefreshingPendingTx,
  isCancellingPendingTx,
  onRefreshPendingTx,
  onCancelPendingTx,
}: WalletSettingsPendingTxPanelProps) {
  const hasPending = Boolean(pendingTransactionStatus && pendingTransactionStatus.nonceGap > 0);
  const isPendingTxActionBusy = isRefreshingPendingTx || isCancellingPendingTx;
  const checkPendingTxLabel = isRefreshingPendingTx
    ? "Checking latest and pending nonces for the Privy wallet"
    : "Check latest and pending nonces for the Privy wallet";
  const clearPendingTxLabel = isCancellingPendingTx
    ? "Clearing the oldest stuck Privy wallet nonce"
    : hasPending
      ? "Replace the oldest stuck nonce with a 0 ETH self-transaction"
      : "Run Check first; available only when a stuck nonce is detected";

  return (
    <UiPanel tone={hasPending ? "warning" : "subtle"} padding="sm" className="animate-slide-up" style={{ animationDelay: "0.04s" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Pending Transactions</div>
          <div role="status" aria-live="polite" aria-atomic="true" aria-busy={isRefreshingPendingTx || isCancellingPendingTx}>
            {pendingTransactionStatus ? (
              hasPending ? (
                <p className="text-[10px] text-amber-200 leading-relaxed">
                  Stuck pending transaction detected. Nonce gap: {pendingTransactionStatus.nonceGap}. Oldest blocked nonce: {pendingTransactionStatus.blockedNonce}.
                  New bets, claims, deposits, and withdrawals can queue behind it until this nonce is cleared.
                </p>
              ) : (
                <p className="text-[10px] text-emerald-300 leading-relaxed">
                  No pending nonce blockage detected for the Privy wallet.
                </p>
              )
            ) : (
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Check the embedded wallet nonce state. If a transaction is stuck, you can replace it with a 0 ETH self-transaction to clear the queue.
              </p>
            )}
          </div>
          {pendingTransactionStatus && (
            <div className="mt-2 flex flex-wrap gap-2 text-[9px] font-mono text-slate-500">
              <span>latest {pendingTransactionStatus.latestNonce}</span>
              <span>pending {pendingTransactionStatus.pendingNonce}</span>
              <span>checked {new Date(pendingTransactionStatus.updatedAt).toLocaleTimeString()}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <UiButton
            onClick={onRefreshPendingTx}
            variant="secondary"
            size="sm"
            uppercase
            disabled={isPendingTxActionBusy}
            aria-label={checkPendingTxLabel}
            title={checkPendingTxLabel}
          >
            {isRefreshingPendingTx ? "Checking..." : "Check"}
          </UiButton>
          <UiButton
            onClick={onCancelPendingTx}
            variant="danger"
            size="sm"
            uppercase
            disabled={isPendingTxActionBusy || !hasPending}
            aria-label={clearPendingTxLabel}
            title={clearPendingTxLabel}
          >
            {isCancellingPendingTx ? "Clearing..." : "Clear Stuck Tx"}
          </UiButton>
        </div>
      </div>
    </UiPanel>
  );
});
