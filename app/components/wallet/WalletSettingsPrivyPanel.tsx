"use client";

import React from "react";
import { shortenAddress } from "../../lib/utils";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";
import { WalletTransferRow } from "./WalletTransferRow";

interface WalletSettingsPrivyPanelProps {
  embeddedWalletAddress: string | null;
  externalWalletAddress: string | null;
  embeddedAddressCopied: boolean;
  depositEthAmount: string;
  depositTokenAmount: string;
  isDepositingEth: boolean;
  isDepositingToken: boolean;
  isClearingEip7702Delegation: boolean;
  embeddedWallet7702DelegateAddress: string | null;
  embeddedWalletCodeChecking: boolean;
  onCopyEmbeddedAddress: () => void;
  onExportEmbeddedWallet: () => void;
  onCreateEmbeddedWallet: () => void;
  onDepositEthAmountChange: (value: string) => void;
  onDepositTokenAmountChange: (value: string) => void;
  onDepositEthToEmbedded: () => void;
  onDepositTokenToEmbedded: () => void;
  onClearEip7702Delegation: () => void;
}

export const WalletSettingsPrivyPanel = React.memo(function WalletSettingsPrivyPanel({
  embeddedWalletAddress,
  externalWalletAddress,
  embeddedAddressCopied,
  depositEthAmount,
  depositTokenAmount,
  isDepositingEth,
  isDepositingToken,
  isClearingEip7702Delegation,
  embeddedWallet7702DelegateAddress,
  embeddedWalletCodeChecking,
  onCopyEmbeddedAddress,
  onExportEmbeddedWallet,
  onCreateEmbeddedWallet,
  onDepositEthAmountChange,
  onDepositTokenAmountChange,
  onDepositEthToEmbedded,
  onDepositTokenToEmbedded,
  onClearEip7702Delegation,
}: WalletSettingsPrivyPanelProps) {
  return (
    <UiPanel tone="accent" className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest">Privy Embedded Wallet</div>
        <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-synced-pulse" />
          All bets
        </span>
      </div>

      {embeddedWalletAddress ? (
        <>
          <p className="text-[10px] text-gray-400 mb-2">All bets go through this wallet. Deposit LINEA and ETH (for gas) here.</p>
          <div className="text-xs text-white font-mono break-all mb-3 bg-black/20 px-2 py-1.5 rounded-lg border border-white/4">
            {embeddedWalletAddress}
          </div>
          <div className="flex flex-wrap gap-2">
            <UiButton onClick={onCopyEmbeddedAddress} variant="ghost" uppercase size="sm">
              {embeddedAddressCopied ? "Copied" : "Copy"}
            </UiButton>
          </div>

          {(embeddedWallet7702DelegateAddress || embeddedWalletCodeChecking) && (
            <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/7 p-3">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-sky-200">Wallet repair</div>
              <p className="mb-2 text-[10px] leading-relaxed text-sky-100/70">
                {embeddedWallet7702DelegateAddress
                  ? `Old EIP-7702 delegation is active: ${shortenAddress(embeddedWallet7702DelegateAddress)}. Clear it to allow normal ETH top-ups.`
                  : "Checking embedded wallet code..."}
              </p>
              <UiButton
                onClick={onClearEip7702Delegation}
                variant="secondary"
                uppercase
                size="sm"
                disabled={!embeddedWallet7702DelegateAddress || isClearingEip7702Delegation}
                loading={isClearingEip7702Delegation}
              >
                Clear Delegation
              </UiButton>
            </div>
          )}

          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/6 p-3">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">Security action</div>
            <p className="mb-2 text-[10px] leading-relaxed text-amber-100/70">
              Export reveals the private key for this embedded wallet. Use it only when you are ready to store or import it safely.
            </p>
            <UiButton onClick={onExportEmbeddedWallet} variant="warning" uppercase size="sm">
              Export Key
            </UiButton>
          </div>

          <div className="mt-3 rounded-lg border border-violet-500/15 bg-black/20 p-3">
            <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1.5">Quick top-up from external wallet</div>
            <div className="text-[10px] text-gray-500 mb-2">
              From: {externalWalletAddress ? shortenAddress(externalWalletAddress) : "none"}
            </div>

            <div className="space-y-2">
              <WalletTransferRow
                assetLabel="ETH"
                assetVariant="secondary"
                value={depositEthAmount}
                onChange={onDepositEthAmountChange}
                placeholder="ETH amount"
                buttonLabel="Send ETH"
                onSubmit={onDepositEthToEmbedded}
                disabled={isDepositingEth || !externalWalletAddress || !embeddedWalletAddress}
                loading={isDepositingEth}
                buttonVariant="secondary"
              />
              <WalletTransferRow
                assetLabel="LINEA"
                assetVariant="success"
                value={depositTokenAmount}
                onChange={onDepositTokenAmountChange}
                placeholder="LINEA amount"
                buttonLabel="Send LINEA"
                onSubmit={onDepositTokenToEmbedded}
                disabled={isDepositingToken || !externalWalletAddress || !embeddedWalletAddress}
                loading={isDepositingToken}
                buttonVariant="success"
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-2">Not created yet.</p>
          <UiButton onClick={onCreateEmbeddedWallet} variant="success" size="sm" uppercase>
            Create Privy Wallet
          </UiButton>
        </>
      )}

      <p className="text-[11px] text-gray-500 mt-3">
        To own your key - <span className="text-white font-semibold">Export</span> and import into MetaMask.
      </p>
    </UiPanel>
  );
});
