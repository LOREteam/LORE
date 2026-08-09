"use client";

import React from "react";
import { getExplorerTxUrl } from "../../lib/explorerLinks";
import { shortenAddress } from "../../lib/utils";
import type { WalletTransfersSummary } from "../../hooks/useWalletTransfers";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";
import { WalletTransferRow } from "./WalletTransferRow";

interface WalletSettingsTransferPanelsProps {
  embeddedWalletAddress: string | null;
  externalWalletAddress: string | null;
  formattedLineaBalance: string | null;
  formattedEthBalance: string | null;
  withdrawAmount: string;
  withdrawEthAmount: string;
  isWithdrawing: boolean;
  isWithdrawingEth: boolean;
  walletTransfers: WalletTransfersSummary | null;
  walletTransfersLoading: boolean;
  onWithdrawAmountChange: (value: string) => void;
  onWithdrawEthAmountChange: (value: string) => void;
  onWithdrawToExternal: () => void;
  onWithdrawEthToExternal: () => void;
  onLoadWalletTransfers: () => void;
}

export const WalletSettingsTransferPanels = React.memo(function WalletSettingsTransferPanels({
  embeddedWalletAddress,
  externalWalletAddress,
  formattedLineaBalance,
  formattedEthBalance,
  withdrawAmount,
  withdrawEthAmount,
  isWithdrawing,
  isWithdrawingEth,
  walletTransfers,
  walletTransfersLoading,
  onWithdrawAmountChange,
  onWithdrawEthAmountChange,
  onWithdrawToExternal,
  onWithdrawEthToExternal,
  onLoadWalletTransfers,
}: WalletSettingsTransferPanelsProps) {
  const transferHistoryLoadLabel = walletTransfersLoading ? "Loading LINEA transfer history" : "Load LINEA transfer history";

  return (
    <>
      <UiPanel tone="default" className="animate-slide-up" style={{ animationDelay: "0.15s" }}>
        <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1.5">Withdraw to Deposit Wallet</div>
        <div className="text-xs text-gray-500 mb-1">To: {externalWalletAddress ? shortenAddress(externalWalletAddress) : "none"}</div>
        <div className="text-xs text-gray-500 mb-1">
          LINEA Balance: <span className="text-white font-semibold">{formattedLineaBalance ?? "0.00"} LINEA</span>
        </div>
        <div className="text-xs text-gray-500 mb-2">
          ETH Balance: <span className="text-white font-semibold">{formattedEthBalance ?? "0.0000"} ETH</span>
        </div>
        <div className="space-y-2">
          <WalletTransferRow
            assetLabel="ETH"
            assetVariant="secondary"
            value={withdrawEthAmount}
            onChange={onWithdrawEthAmountChange}
            placeholder="ETH amount"
            buttonLabel="Send ETH"
            onSubmit={onWithdrawEthToExternal}
            disabled={isWithdrawingEth || !externalWalletAddress || !embeddedWalletAddress}
            loading={isWithdrawingEth}
            buttonVariant="secondary"
          />
          <WalletTransferRow
            assetLabel="LINEA"
            assetVariant="sky"
            value={withdrawAmount}
            onChange={onWithdrawAmountChange}
            placeholder="LINEA amount"
            buttonLabel="Send LINEA"
            onSubmit={onWithdrawToExternal}
            disabled={isWithdrawing || !externalWalletAddress || !embeddedWalletAddress}
            loading={isWithdrawing}
            buttonVariant="sky"
          />
        </div>
      </UiPanel>

      {embeddedWalletAddress && (
        <UiPanel tone="default" className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
          <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1">LINEA Transfer History</div>
          {externalWalletAddress && (
            <div className="text-[9px] text-gray-500 mb-3">
              Deposits and withdrawals between your wallets only (game rewards stay claimable in-app)
            </div>
          )}

          {walletTransfers === null ? (
            <>
              {walletTransfersLoading && (
                <span className="sr-only" role="status" aria-live="polite">
                  {transferHistoryLoadLabel}
                </span>
              )}
              <UiButton
                onClick={onLoadWalletTransfers}
                disabled={walletTransfersLoading}
                variant="secondary"
                size="md"
                uppercase
                fullWidth
                loading={walletTransfersLoading}
                className="text-[10px]"
                aria-label={transferHistoryLoadLabel}
                title={transferHistoryLoadLabel}
              >
                {walletTransfersLoading ? "Loading..." : "Load History"}
              </UiButton>
            </>
          ) : (
            <>
              <div className="flex gap-3 mb-3">
                <div className="flex-1 rounded-lg bg-emerald-500/6 border border-emerald-500/20 p-2.5 text-center">
                  <div className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-0.5">Deposited</div>
                  <div className="lore-nums text-sm font-bold text-emerald-400">{walletTransfers.totalInDisplay}</div>
                  <div className="text-[9px] text-gray-400">LINEA</div>
                </div>
                <div className="flex-1 rounded-lg bg-red-500/6 border border-red-500/20 p-2.5 text-center">
                  <div className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-0.5">Withdrawn</div>
                  <div className="lore-nums text-sm font-bold text-red-400">{walletTransfers.totalOutDisplay}</div>
                  <div className="text-[9px] text-gray-400">LINEA</div>
                </div>
              </div>

              {walletTransfers.transfers.length > 0 ? (
                <div role="list" aria-label="LINEA transfer history" className="max-h-[180px] overflow-y-auto rounded-lg border border-white/4 divide-y divide-white/4">
                  {walletTransfers.transfers.map((transfer, index) => (
                    <WalletTransferHistoryRow key={`${transfer.txHash}-${index}`} transfer={transfer} />
                  ))}
                </div>
              ) : (
                <div role="status" aria-live="polite" className="text-center py-3 text-[10px] text-gray-400 italic">No ore has moved through these tunnels.</div>
              )}
            </>
          )}
        </UiPanel>
      )}
    </>
  );
});

const WalletTransferHistoryRow = React.memo(function WalletTransferHistoryRow({
  transfer,
}: {
  transfer: NonNullable<WalletTransfersSummary["transfers"]>[number];
}) {
  const isInbound = transfer.direction === "in";
  const txUrl = getExplorerTxUrl(transfer.txHash);
  const explorerLabel = `Open ${isInbound ? "inbound" : "outbound"} LINEA transfer on Lineascan`;

  return (
    <div role="listitem" className="flex items-center justify-between px-3 py-2 hover:bg-white/2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isInbound ? "text-emerald-400" : "text-red-400"}`}>
          {isInbound ? "IN" : "OUT"}
        </span>
        {txUrl ? (
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={explorerLabel}
            title={explorerLabel}
            className="text-[9px] font-mono text-violet-400/50 hover:text-violet-400 transition-colors"
          >
            {transfer.txHash.slice(0, 8)}...{transfer.txHash.slice(-4)}
          </a>
        ) : (
          <span className="text-[9px] font-mono text-gray-500">pending</span>
        )}
      </div>
      <span className={`lore-nums text-xs font-bold ${isInbound ? "text-emerald-400" : "text-red-400"}`}>
        {isInbound ? "+" : "-"}{transfer.amount} <span className="text-gray-400 text-[9px]">LINEA</span>
      </span>
    </div>
  );
});
