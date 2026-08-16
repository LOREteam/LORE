"use client";

import React from "react";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";
import type { PendingTransactionStatus } from "../../hooks/useWalletActions";

interface WalletSettingsPendingTxPanelProps {
  pendingTransactionStatus: PendingTransactionStatus | null;
  isRefreshingPendingTx: boolean;
  isCancellingPendingTx: boolean;
  onRefreshPendingTx: (replacementHash?: string) => void | Promise<unknown>;
  onCancelPendingTx: () => void;
}

export type PendingTransactionRefreshAction = "nonce-check" | "replacement";

export interface PendingTransactionPanelPresentation {
  state: "unchecked" | "clear" | "blocked";
  hasPending: boolean;
  busy: boolean;
  checkLabel: string;
  checkButtonText: string;
  replacementLabel: string;
  replacementButtonText: string;
  busyAnnouncement: string | null;
  clearLabel: string;
  checkDisabled: boolean;
  clearDisabled: boolean;
  replacementDisabled: boolean;
}

export function isExactWalletTransactionHash(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export function normalizeWalletTransactionHashInput(value: string) {
  return value.trim().slice(0, 66);
}

export function runPendingTransactionRefreshAction(input: {
  action: PendingTransactionRefreshAction;
  replacementHash: string;
  onRefreshPendingTx: (replacementHash?: string) => void | Promise<unknown>;
  onBusyActionChange: (action: PendingTransactionRefreshAction | null) => void;
}) {
  input.onBusyActionChange(input.action);
  let result: void | Promise<unknown>;
  try {
    result = input.onRefreshPendingTx(
      input.action === "replacement"
        ? normalizeWalletTransactionHashInput(input.replacementHash)
        : undefined,
    );
  } catch (error) {
    input.onBusyActionChange(null);
    throw error;
  }
  if (result && typeof result.then === "function") {
    return Promise.resolve(result).finally(() => input.onBusyActionChange(null));
  }
  input.onBusyActionChange(null);
}

export function getPendingTransactionPanelPresentation(input: {
  pendingTransactionStatus: PendingTransactionStatus | null;
  isRefreshingPendingTx: boolean;
  isCancellingPendingTx: boolean;
  replacementHash: string;
  busyAction?: PendingTransactionRefreshAction | null;
}): PendingTransactionPanelPresentation {
  const hasPending = Boolean(
    input.pendingTransactionStatus && input.pendingTransactionStatus.nonceGap > 0,
  );
  const busyAction = input.busyAction ?? (input.isRefreshingPendingTx ? "nonce-check" : null);
  const busy = input.isRefreshingPendingTx || input.isCancellingPendingTx || busyAction !== null;
  const checkingNonces = busyAction === "nonce-check";
  const verifyingReplacement = busyAction === "replacement";
  return {
    state: input.pendingTransactionStatus ? (hasPending ? "blocked" : "clear") : "unchecked",
    hasPending,
    busy,
    checkLabel: checkingNonces
      ? "Checking latest and pending nonces for the Privy wallet"
      : "Check latest and pending nonces for the Privy wallet",
    checkButtonText: checkingNonces ? "Checking..." : "Check",
    replacementLabel: verifyingReplacement
      ? "Verifying exact wallet transfer replacement across two RPCs"
      : "Verify exact wallet transfer replacement hash",
    replacementButtonText: verifyingReplacement ? "Verifying replacement..." : "Verify Replacement",
    busyAnnouncement: checkingNonces
      ? "Checking latest and pending nonces for the Privy wallet."
      : verifyingReplacement
        ? "Verifying replacement transaction across two independent RPCs."
        : input.isCancellingPendingTx
          ? "Clearing the oldest stuck Privy wallet nonce."
          : null,
    clearLabel: input.isCancellingPendingTx
      ? "Clearing the oldest stuck Privy wallet nonce"
      : hasPending
        ? "Replace the oldest stuck nonce with a 0 ETH self-transaction"
        : "Run Check first; available only when a stuck nonce is detected",
    checkDisabled: busy,
    clearDisabled: busy || !hasPending,
    replacementDisabled: busy || !isExactWalletTransactionHash(input.replacementHash),
  };
}

export const WalletSettingsPendingTxPanel = React.memo(function WalletSettingsPendingTxPanel({
  pendingTransactionStatus,
  isRefreshingPendingTx,
  isCancellingPendingTx,
  onRefreshPendingTx,
  onCancelPendingTx,
}: WalletSettingsPendingTxPanelProps) {
  const [replacementHash, setReplacementHash] = React.useState("");
  const [busyAction, setBusyAction] = React.useState<PendingTransactionRefreshAction | null>(null);
  const busyActionRef = React.useRef<PendingTransactionRefreshAction | null>(null);
  const updateBusyAction = React.useCallback((action: PendingTransactionRefreshAction | null) => {
    busyActionRef.current = action;
    setBusyAction(action);
  }, []);
  const startRefreshAction = React.useCallback((action: PendingTransactionRefreshAction) => {
    if (busyActionRef.current || isRefreshingPendingTx || isCancellingPendingTx) return;
    void runPendingTransactionRefreshAction({
      action,
      replacementHash,
      onRefreshPendingTx,
      onBusyActionChange: updateBusyAction,
    });
  }, [isCancellingPendingTx, isRefreshingPendingTx, onRefreshPendingTx, replacementHash, updateBusyAction]);
  const presentation = getPendingTransactionPanelPresentation({
    pendingTransactionStatus,
    isRefreshingPendingTx,
    isCancellingPendingTx,
    replacementHash,
    busyAction,
  });

  return (
    <UiPanel tone={presentation.hasPending ? "warning" : "subtle"} padding="sm" className="animate-slide-up" style={{ animationDelay: "0.04s" }}>
      <div
        className="flex items-start justify-between gap-3"
        data-pending-transaction-state={presentation.state}
      >
        {presentation.busyAnnouncement && (
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {presentation.busyAnnouncement}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Pending Transactions</div>
          <div role="status" aria-live="polite" aria-atomic="true" aria-busy={presentation.busy}>
            {pendingTransactionStatus ? (
              presentation.hasPending ? (
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
          <div className="mt-3 border-t border-white/5 pt-3">
            <label
              htmlFor="wallet-replacement-hash"
              className="block text-[9px] font-semibold uppercase tracking-wider text-gray-400"
            >
              Exact replacement hash
            </label>
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
              If your wallet repriced a transfer and the original hash disappeared, paste the replacement hash. Two RPCs must prove the same sender, nonce, destination, value, calldata, and transaction type before migration. Finality is still required before the block can be released.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="wallet-replacement-hash"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                value={replacementHash}
                onChange={(event) => setReplacementHash(normalizeWalletTransactionHashInput(event.target.value))}
                placeholder="0x…"
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 font-mono text-[10px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
              />
              <UiButton
                onClick={() => startRefreshAction("replacement")}
                variant="secondary"
                size="sm"
                uppercase
                disabled={presentation.replacementDisabled}
                aria-label={presentation.replacementLabel}
                title={presentation.replacementLabel}
              >
                {presentation.replacementButtonText}
              </UiButton>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <UiButton
            onClick={() => startRefreshAction("nonce-check")}
            variant="secondary"
            size="sm"
            uppercase
            disabled={presentation.checkDisabled}
            aria-label={presentation.checkLabel}
            title={presentation.checkLabel}
          >
            {presentation.checkButtonText}
          </UiButton>
          <UiButton
            onClick={onCancelPendingTx}
            variant="danger"
            size="sm"
            uppercase
            disabled={presentation.clearDisabled}
            aria-label={presentation.clearLabel}
            title={presentation.clearLabel}
          >
            {isCancellingPendingTx ? "Clearing..." : "Clear Stuck Tx"}
          </UiButton>
        </div>
      </div>
    </UiPanel>
  );
});
