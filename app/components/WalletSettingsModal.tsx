"use client";

import React from "react";
import { formatUnits } from "viem";
import { EXPLORER_TX_BASE_URL } from "../lib/constants";
import { downloadLogs } from "../lib/logger";
import { shortenAddress } from "../lib/utils";
import type { WalletTransfersSummary } from "../hooks/useWalletTransfers";
import type { UnclaimedWin } from "../lib/types";
import type { SoundName } from "../hooks/useSound";
import { SOUND_LABELS } from "../hooks/useSound";
import { UiButton } from "./ui/UiButton";
import { UiInput } from "./ui/UiInput";
import { UiPanel } from "./ui/UiPanel";
import { uiTokens } from "./ui/tokens";

interface WalletSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectedWalletAddress?: string;
  embeddedWalletAddress: string | null;
  externalWalletAddress: string | null;
  formattedLineaBalance: string | null;
  formattedEthBalance: string | null;
  withdrawAmount: string;
  withdrawEthAmount: string;
  depositEthAmount: string;
  depositTokenAmount: string;
  isWithdrawing: boolean;
  isWithdrawingEth: boolean;
  isDepositingEth: boolean;
  isDepositingToken: boolean;
  onWithdrawAmountChange: (value: string) => void;
  onWithdrawEthAmountChange: (value: string) => void;
  onDepositEthAmountChange: (value: string) => void;
  onDepositTokenAmountChange: (value: string) => void;
  onCreateEmbeddedWallet: () => void;
  onCopyEmbeddedAddress: () => void;
  embeddedAddressCopied?: boolean;
  onExportEmbeddedWallet: () => void;
  onWithdrawToExternal: () => void;
  onWithdrawEthToExternal: () => void;
  onDepositEthToEmbedded: () => void;
  onDepositTokenToEmbedded: () => void;
  walletTransfers: WalletTransfersSummary | null;
  walletTransfersLoading: boolean;
  onLoadWalletTransfers: () => void;
  deepScanWins: UnclaimedWin[] | null;
  deepScanScanning: boolean;
  deepScanClaiming: boolean;
  deepScanProgress: string;
  onDeepScan: () => void;
  onDeepScanStop: () => void;
  onDeepClaimOne: (epochId: string) => void;
  onDeepClaimAll: () => void;
  soundSettings?: Partial<Record<SoundName, boolean>>;
  onSoundSettingChange?: (name: SoundName, enabled: boolean) => void;
  reducedMotion?: boolean;
  onReducedMotionChange?: (enabled: boolean) => void;
}

interface TransferRowProps {
  assetLabel: string;
  assetVariant: NonNullable<React.ComponentProps<typeof UiButton>["variant"]>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  buttonLabel: string;
  onSubmit: () => void;
  disabled: boolean;
  loading: boolean;
  buttonVariant: NonNullable<React.ComponentProps<typeof UiButton>["variant"]>;
}

const transferBadgeVariantClasses: Record<NonNullable<TransferRowProps["assetVariant"]>, string> = {
  primary: "border-violet-400/45 bg-violet-500/15 text-violet-200",
  secondary: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  ghost: "border-white/12 bg-white/[0.02] text-slate-300",
  success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  danger: "border-red-500/35 bg-red-500/10 text-red-300",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-300",
  sky: "border-sky-500/35 bg-sky-500/10 text-sky-300",
};

function TransferRow({
  assetLabel,
  assetVariant,
  value,
  onChange,
  placeholder,
  buttonLabel,
  onSubmit,
  disabled,
  loading,
  buttonVariant,
}: TransferRowProps) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_8rem] items-center gap-2">
      <div
        className={`flex h-10 items-center justify-center rounded-xl border text-[10px] font-semibold uppercase tracking-widest shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${transferBadgeVariantClasses[assetVariant]}`}
      >
        <span className="block w-full text-center leading-none">
          {assetLabel}
        </span>
      </div>
      <UiInput
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-0"
        placeholder={placeholder}
      />
      <UiButton
        onClick={onSubmit}
        disabled={disabled}
        variant={buttonVariant}
        size="md"
        uppercase
        loading={loading}
        className="h-10 w-full text-[10px]"
      >
        {loading ? "Sending…" : buttonLabel}
      </UiButton>
    </div>
  );
}

export const WalletSettingsModal = React.memo(function WalletSettingsModal({
  isOpen,
  onClose,
  connectedWalletAddress,
  embeddedWalletAddress,
  externalWalletAddress,
  formattedLineaBalance,
  formattedEthBalance,
  withdrawAmount,
  withdrawEthAmount,
  depositEthAmount,
  depositTokenAmount,
  isWithdrawing,
  isWithdrawingEth,
  isDepositingEth,
  isDepositingToken,
  onWithdrawAmountChange,
  onWithdrawEthAmountChange,
  onDepositEthAmountChange,
  onDepositTokenAmountChange,
  onCreateEmbeddedWallet,
  onCopyEmbeddedAddress,
  embeddedAddressCopied = false,
  onExportEmbeddedWallet,
  onWithdrawToExternal,
  onWithdrawEthToExternal,
  onDepositEthToEmbedded,
  onDepositTokenToEmbedded,
  walletTransfers,
  walletTransfersLoading,
  onLoadWalletTransfers,
  deepScanWins,
  deepScanScanning,
  deepScanClaiming,
  deepScanProgress,
  onDeepScan,
  onDeepScanStop,
  onDeepClaimOne,
  onDeepClaimAll,
  soundSettings,
  onSoundSettingChange,
  reducedMotion = false,
  onReducedMotionChange,
}: WalletSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div
        className={`relative w-full max-w-2xl ${uiTokens.radius.lg} ${uiTokens.modalSurface} animate-slide-up overflow-hidden`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-violet-500/10 px-5 py-4">
          <div>
            <h2 className="text-white text-lg font-bold flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Wallet Settings
            </h2>
            <p className="text-gray-500 text-xs mt-0.5">Manage Privy wallet, export keys, withdraw</p>
          </div>
          <div className="flex items-center gap-2">
            <UiButton
              onClick={downloadLogs}
              variant="secondary"
              size="sm"
              uppercase
              className="text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Logs
            </UiButton>
            <UiButton
              onClick={onClose}
              variant="ghost"
              size="sm"
              uppercase
              className="text-xs"
            >
              Close
            </UiButton>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Sound Settings */}
          {soundSettings && onSoundSettingChange && (
            <UiPanel
              tone="subtle"
              padding="sm"
              className="animate-slide-up"
              style={{ animationDelay: "0.02s" }}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider">Sound</span>
                <span className="text-[8px] text-gray-600">when unmuted</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5">
                {(["bet", "autoBet", "reveal", "win", "myWin", "tick"] as SoundName[]).map((name) => (
                  <label
                    key={name}
                    className="flex items-center gap-2 py-1 rounded cursor-pointer hover:bg-white/[0.03] transition-colors group"
                  >
                    <input
                      type="checkbox"
                      checked={soundSettings[name] !== false}
                      onChange={(e) => onSoundSettingChange(name, e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-violet-500/30 bg-violet-500/10 text-violet-500 focus:ring-violet-500/50 focus:ring-offset-0 shrink-0"
                    />
                    <span className="text-[10px] text-gray-400 group-hover:text-gray-300">{SOUND_LABELS[name]}</span>
                  </label>
                ))}
              </div>
            </UiPanel>
          )}

          {onReducedMotionChange && (
            <UiPanel
              tone="subtle"
              padding="sm"
              className="animate-slide-up"
              style={{ animationDelay: "0.035s" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Animation</div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    Reduce visual effects and transitions across the site for weaker PCs. The countdown timer still updates normally.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reducedMotion}
                  onClick={() => onReducedMotionChange(!reducedMotion)}
                  className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors ${
                    reducedMotion
                      ? "justify-end border-emerald-400/40 bg-emerald-500/20"
                      : "justify-start border-white/10 bg-white/[0.05]"
                  }`}
                >
                  <span
                    className="block h-5 w-5 rounded-full bg-white shadow-sm"
                  />
                </button>
              </div>
            </UiPanel>
          )}

          {/* Session */}
          <UiPanel tone="default" className="animate-slide-up" style={{ animationDelay: "0.05s" }}>
            <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1.5">Current Session</div>
            <div className="text-sm text-emerald-400 font-mono font-semibold drop-shadow-[0_0_6px_rgba(52,211,153,0.3)]">
              {connectedWalletAddress ? shortenAddress(connectedWalletAddress) : "Not connected"}
            </div>
          </UiPanel>

          {/* Privy */}
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
                <div className="text-xs text-white font-mono break-all mb-3 bg-black/20 px-2 py-1.5 rounded-lg border border-white/[0.04]">{embeddedWalletAddress}</div>
                <div className="flex flex-wrap gap-2">
                  <UiButton onClick={onCopyEmbeddedAddress} variant="ghost" uppercase size="sm">
                    {embeddedAddressCopied ? "Copied" : "Copy"}
                  </UiButton>
                  <UiButton onClick={onExportEmbeddedWallet} variant="ghost" uppercase size="sm">
                    Export
                  </UiButton>
                </div>

                <div className="mt-3 rounded-lg border border-violet-500/15 bg-black/20 p-3">
                  <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1.5">Quick top-up from external wallet</div>
                  <div className="text-[10px] text-gray-500 mb-2">
                    From: {externalWalletAddress ? shortenAddress(externalWalletAddress) : "none"}
                  </div>

                  <div className="space-y-2">
                    <TransferRow
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

                    <TransferRow
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
              To own your key – <span className="text-white font-semibold">Export</span> and import into MetaMask.
            </p>
          </UiPanel>

          {/* Withdraw */}
          <UiPanel tone="default" className="animate-slide-up" style={{ animationDelay: "0.15s" }}>
            <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1.5">Withdraw to Deposit Wallet</div>
            <div className="text-xs text-gray-500 mb-1">
              To: {externalWalletAddress ? shortenAddress(externalWalletAddress) : "none"}
            </div>
            <div className="text-xs text-gray-500 mb-1">
              LINEA Balance: <span className="text-white font-semibold">{formattedLineaBalance ?? "0.00"} LINEA</span>
            </div>
            <div className="text-xs text-gray-500 mb-2">
              ETH Balance: <span className="text-white font-semibold">{formattedEthBalance ?? "0.0000"} ETH</span>
            </div>
            <div className="space-y-2">
              <TransferRow
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
              <TransferRow
                assetLabel="LINEA"
                assetVariant="sky"
                value={withdrawAmount}
                onChange={onWithdrawAmountChange}
                placeholder="LINEA amount"
                buttonLabel="Send LINEA"
                onSubmit={onWithdrawToExternal}
                disabled={isWithdrawing || !externalWalletAddress}
                loading={isWithdrawing}
                buttonVariant="sky"
              />
            </div>
          </UiPanel>

          {/* Transfer History */}
          {embeddedWalletAddress && (
            <UiPanel tone="default" className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
              <div className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mb-1">LINEA Transfer History</div>
                {externalWalletAddress && <div className="text-[9px] text-gray-500 mb-3">Deposits and withdrawals between your wallets only (game rewards stay claimable in-app)</div>}

              {walletTransfers === null ? (
                <UiButton
                  onClick={onLoadWalletTransfers}
                  disabled={walletTransfersLoading}
                  variant="secondary"
                  size="md"
                  uppercase
                  fullWidth
                  loading={walletTransfersLoading}
                  className="text-[10px]"
                >
                  {walletTransfersLoading ? "Loading…" : "Load History"}
                </UiButton>
              ) : (
                <>
                  <div className="flex gap-3 mb-3">
                    <div className="flex-1 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 p-2.5 text-center">
                      <div className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-0.5">Deposited</div>
                      <div className="text-sm font-bold text-emerald-400 font-mono">{walletTransfers.totalIn.toFixed(2)}</div>
                      <div className="text-[9px] text-gray-600">LINEA</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-red-500/[0.06] border border-red-500/20 p-2.5 text-center">
                      <div className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mb-0.5">Withdrawn</div>
                      <div className="text-sm font-bold text-red-400 font-mono">{walletTransfers.totalOut.toFixed(2)}</div>
                      <div className="text-[9px] text-gray-600">LINEA</div>
                    </div>
                  </div>

                  {walletTransfers.transfers.length > 0 ? (
                    <div className="max-h-[180px] overflow-y-auto rounded-lg border border-white/[0.04] divide-y divide-white/[0.04]">
                      {walletTransfers.transfers.map((t, i) => (
                        <div key={`${t.txHash}-${i}`} className="flex items-center justify-between px-3 py-2 hover:bg-white/[0.02]">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${t.direction === "in" ? "text-emerald-400" : "text-red-400"}`}>
                              {t.direction === "in" ? "↓ IN" : "↑ OUT"}
                            </span>
                            <a
                              href={`${EXPLORER_TX_BASE_URL}/${t.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] font-mono text-violet-400/50 hover:text-violet-400 transition-colors"
                            >
                              {t.txHash.slice(0, 8)}…{t.txHash.slice(-4)}
                            </a>
                          </div>
                          <span className={`text-xs font-bold font-mono ${t.direction === "in" ? "text-emerald-400" : "text-red-400"}`}>
                            {t.direction === "in" ? "+" : "−"}{t.amount} <span className="text-gray-600 text-[9px]">LINEA</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-3 text-[10px] text-gray-600 italic">No ore has moved through these tunnels.</div>
                  )}
                </>
              )}
            </UiPanel>
          )}

          {/* Deep Reward Scan */}
          <UiPanel tone="warning" className="animate-slide-up" style={{ animationDelay: "0.25s" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-amber-300 font-bold uppercase tracking-widest flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Deep Reward Scan
              </div>
              {deepScanWins && deepScanWins.length > 0 && !deepScanScanning && (
                <UiButton
                  onClick={onDeepClaimAll}
                  disabled={deepScanClaiming}
                  variant="warning"
                  size="xs"
                  uppercase
                  loading={deepScanClaiming}
                  className="font-bold text-[9px]"
                >
                  {deepScanClaiming ? "Claiming…" : `Claim All (${deepScanWins.length})`}
                </UiButton>
              )}
            </div>
            <p className="text-[10px] text-gray-500 mb-3">Scans ALL epochs from the start of the contract. Use if you might have unclaimed rewards older than 48 hours.</p>

            {deepScanWins === null && !deepScanScanning ? (
              <UiButton
                onClick={onDeepScan}
                variant="warning"
                size="md"
                uppercase
                fullWidth
                className="text-[10px]"
              >
                Start Full Scan
              </UiButton>
            ) : deepScanScanning ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-[10px] text-gray-400 font-mono">{deepScanProgress}</span>
                </div>
                <UiButton
                  onClick={onDeepScanStop}
                  variant="danger"
                  size="sm"
                  uppercase
                  fullWidth
                  className="text-[10px]"
                >
                  Stop Scan
                </UiButton>
              </div>
            ) : deepScanWins && deepScanWins.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[10px] text-gray-500 font-mono">{deepScanProgress}</div>
                <div className="max-h-[160px] overflow-y-auto rounded-lg border border-amber-500/15 divide-y divide-white/[0.04]">
                  {deepScanWins.map((win) => (
                    <div key={win.epoch} className="flex items-center justify-between px-3 py-2 hover:bg-white/[0.02]">
                      <div className="flex flex-col">
                        <span className="text-[9px] text-amber-500/60 font-bold uppercase tracking-wider">Epoch #{win.epoch}</span>
                        <span className="text-xs font-bold text-emerald-400">{parseFloat(formatUnits(BigInt(win.amountWei), 18)).toFixed(2)} LINEA</span>
                      </div>
                      <UiButton
                        onClick={() => onDeepClaimOne(win.epoch)}
                        disabled={deepScanClaiming}
                        variant="warning"
                        size="xs"
                        uppercase
                        className="text-[9px]"
                      >
                        Claim
                      </UiButton>
                    </div>
                  ))}
                </div>
              </div>
            ) : deepScanWins !== null ? (
              <div className="space-y-2">
                <div className="text-[10px] text-gray-500 font-mono">{deepScanProgress}</div>
                <div className="flex items-center justify-center gap-1.5 py-2 text-gray-600">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-[9px] uppercase font-bold tracking-widest">All rewards claimed</span>
                </div>
                <UiButton
                  onClick={onDeepScan}
                  variant="ghost"
                  size="sm"
                  uppercase
                  fullWidth
                  className="text-[10px]"
                >
                  Scan Again
                </UiButton>
              </div>
            ) : null}
          </UiPanel>
        </div>
      </div>
    </div>
  );
});
