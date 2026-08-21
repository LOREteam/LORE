"use client";

import React, { useState } from "react";
import { downloadLogs } from "../lib/logger";
import { UiButton } from "./ui/UiButton";
import { uiTokens } from "./ui/tokens";
import { cn } from "../lib/cn";
import { WalletSettingsDeepScanPanel } from "./wallet/WalletSettingsDeepScanPanel";
import { WalletSettingsOverviewPanel } from "./wallet/WalletSettingsOverviewPanel";
import { WalletSettingsPendingTxPanel } from "./wallet/WalletSettingsPendingTxPanel";
import { WalletSettingsPrivyPanel } from "./wallet/WalletSettingsPrivyPanel";
import { WalletSettingsTransferPanels } from "./wallet/WalletSettingsTransferPanels";
import type { WalletSettingsModalProps } from "./wallet/types";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap";

type WalletSettingsSection = "all" | "overview" | "privy" | "transfer" | "scan";

const SECTIONS: Array<{ id: WalletSettingsSection; label: string }> = [
  { id: "all" as const, label: "All" },
  { id: "overview" as const, label: "General" },
  { id: "privy" as const, label: "Privy" },
  { id: "transfer" as const, label: "Transfer" },
  { id: "scan" as const, label: "Scan" },
];

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
  walletSetupCreating,
  walletSetupError,
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
  connectedResolverRewards,
  connectedResolverRewardsWei,
  embeddedResolverRewards,
  embeddedResolverRewardsWei,
  isClaimingConnectedResolverRewards,
  isClaimingEmbeddedResolverRewards,
  onClaimConnectedResolverRewards,
  onClaimEmbeddedResolverRewards,
  soundSettings,
  onSoundSettingChange,
  reducedMotion = false,
  onReducedMotionChange,
  pendingTransactionStatus,
  isRefreshingPendingTx,
  isCancellingPendingTx,
  onRefreshPendingTx,
  onCancelPendingTx,
}: WalletSettingsModalProps) {
  const [activeSection, setActiveSection] = useState<WalletSettingsSection>("all");
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-2 animate-fade-in sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-settings-title"
        aria-describedby="wallet-settings-description"
        tabIndex={-1}
        className={`relative flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col ${uiTokens.radius.lg} ${uiTokens.modalSurface} animate-slide-up overflow-hidden sm:max-h-[calc(100dvh-2rem)]`}
      >
        <div className="flex items-center justify-between border-b border-violet-500/10 px-5 py-4">
          <div>
            <h2 id="wallet-settings-title" className="text-white text-lg font-bold flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Wallet Settings
            </h2>
            <p id="wallet-settings-description" className="text-gray-500 text-xs mt-0.5">Manage Privy wallet, export keys, withdraw</p>
          </div>
          <div className="flex items-center gap-2">
            <UiButton
              onClick={downloadLogs}
              variant="secondary"
              size="sm"
              uppercase
              aria-label="Export support logs"
              title="Export support logs"
              className="text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">Export Logs</span>
            </UiButton>
            <UiButton onClick={onClose} variant="ghost" size="sm" uppercase className="text-xs">
              Close
            </UiButton>
          </div>
        </div>

        {/* Section tabs for mobile navigation */}
        <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-violet-500/10 px-4 py-2 sm:hidden">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              aria-pressed={activeSection === s.id}
              className={cn(
                "min-h-11 shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
                activeSection === s.id
                  ? "bg-violet-500/15 text-violet-300 border border-violet-400/30"
                  : "text-slate-500 hover:text-slate-300 border border-transparent",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-5">
          {(activeSection === "all" || activeSection === "overview") && (
            <>
              <WalletSettingsOverviewPanel
                connectedWalletAddress={connectedWalletAddress}
                embeddedWalletAddress={embeddedWalletAddress}
                connectedResolverRewards={connectedResolverRewards}
                connectedResolverRewardsWei={connectedResolverRewardsWei}
                embeddedResolverRewards={embeddedResolverRewards}
                embeddedResolverRewardsWei={embeddedResolverRewardsWei}
                isClaimingConnectedResolverRewards={isClaimingConnectedResolverRewards}
                isClaimingEmbeddedResolverRewards={isClaimingEmbeddedResolverRewards}
                onClaimConnectedResolverRewards={onClaimConnectedResolverRewards}
                onClaimEmbeddedResolverRewards={onClaimEmbeddedResolverRewards}
                soundSettings={soundSettings}
                onSoundSettingChange={onSoundSettingChange}
                reducedMotion={reducedMotion}
                onReducedMotionChange={onReducedMotionChange}
              />

              <WalletSettingsPendingTxPanel
                pendingTransactionStatus={pendingTransactionStatus}
                isRefreshingPendingTx={isRefreshingPendingTx}
                isCancellingPendingTx={isCancellingPendingTx}
                onRefreshPendingTx={onRefreshPendingTx}
                onCancelPendingTx={onCancelPendingTx}
              />
            </>
          )}

          {(activeSection === "all" || activeSection === "privy") && (
            <WalletSettingsPrivyPanel
              embeddedWalletAddress={embeddedWalletAddress}
              externalWalletAddress={externalWalletAddress}
              embeddedAddressCopied={embeddedAddressCopied}
              depositEthAmount={depositEthAmount}
              depositTokenAmount={depositTokenAmount}
              isDepositingEth={isDepositingEth}
              isDepositingToken={isDepositingToken}
              onCopyEmbeddedAddress={onCopyEmbeddedAddress}
              onExportEmbeddedWallet={onExportEmbeddedWallet}
              onCreateEmbeddedWallet={onCreateEmbeddedWallet}
              walletSetupCreating={walletSetupCreating}
              walletSetupError={walletSetupError}
              onDepositEthAmountChange={onDepositEthAmountChange}
              onDepositTokenAmountChange={onDepositTokenAmountChange}
              onDepositEthToEmbedded={onDepositEthToEmbedded}
              onDepositTokenToEmbedded={onDepositTokenToEmbedded}
            />
          )}

          {(activeSection === "all" || activeSection === "transfer") && (
            <WalletSettingsTransferPanels
              embeddedWalletAddress={embeddedWalletAddress}
              externalWalletAddress={externalWalletAddress}
              formattedLineaBalance={formattedLineaBalance}
              formattedEthBalance={formattedEthBalance}
              withdrawAmount={withdrawAmount}
              withdrawEthAmount={withdrawEthAmount}
              isWithdrawing={isWithdrawing}
              isWithdrawingEth={isWithdrawingEth}
              walletTransfers={walletTransfers}
              walletTransfersLoading={walletTransfersLoading}
              onWithdrawAmountChange={onWithdrawAmountChange}
              onWithdrawEthAmountChange={onWithdrawEthAmountChange}
              onWithdrawToExternal={onWithdrawToExternal}
              onWithdrawEthToExternal={onWithdrawEthToExternal}
              onLoadWalletTransfers={onLoadWalletTransfers}
            />
          )}

          {(activeSection === "all" || activeSection === "scan") && (
            <WalletSettingsDeepScanPanel
              deepScanWins={deepScanWins}
              deepScanScanning={deepScanScanning}
              deepScanClaiming={deepScanClaiming}
              deepScanProgress={deepScanProgress}
              onDeepScan={onDeepScan}
              onDeepScanStop={onDeepScanStop}
              onDeepClaimOne={onDeepClaimOne}
              onDeepClaimAll={onDeepClaimAll}
            />
          )}
        </div>
      </div>
    </div>
  );
});
