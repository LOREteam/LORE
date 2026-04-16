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

  return (
    <UiPanel tone={hasPending ? "warning" : "subtle"} padding="sm" className="animate-slide-up" style={{ animationDelay: "0.04s" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Pending Transactions</div>
          {pendingTransactionStatus ? (
            hasPending ? (
              <p className="text-[10px] text-amber-200 leading-relaxed">
                Stuck pending transaction detected. Nonce gap: {pendingTransactionStatus.nonceGap}. Oldest blocked nonce: {pendingTransactionStatus.blockedNonce}.
                New bets can queue behind it and appear to do nothing until this nonce is cleared.
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
        <div className="flex shrink-0 gap-2">
          <UiButton onClick={onRefreshPendingTx} variant="secondary" size="sm" uppercase disabled={isRefreshingPendingTx}>
            {isRefreshingPendingTx ? "Checking..." : "Check"}
          </UiButton>
          <UiButton
            onClick={onCancelPendingTx}
            variant="danger"
            size="sm"
            uppercase
            disabled={isCancellingPendingTx || !hasPending}
          >
            {isCancellingPendingTx ? "Clearing..." : "Clear Stuck Tx"}
          </UiButton>
        </div>
      </div>
    </UiPanel>
  );
});
