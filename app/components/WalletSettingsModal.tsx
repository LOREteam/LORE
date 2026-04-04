"use client";

import React from "react";
import { downloadLogs } from "../lib/logger";
import { UiButton } from "./ui/UiButton";
import { uiTokens } from "./ui/tokens";
import { WalletSettingsDeepScanPanel } from "./wallet/WalletSettingsDeepScanPanel";
import { WalletSettingsOverviewPanel } from "./wallet/WalletSettingsOverviewPanel";
import { WalletSettingsPendingTxPanel } from "./wallet/WalletSettingsPendingTxPanel";
import { WalletSettingsPrivyPanel } from "./wallet/WalletSettingsPrivyPanel";
import { WalletSettings7702Panel } from "./wallet/WalletSettings7702Panel";
import { WalletSettingsTransferPanels } from "./wallet/WalletSettingsTransferPanels";
import type { WalletSettingsModalProps } from "./wallet/types";

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
  pendingTransactionStatus,
  isRefreshingPendingTx,
  isCancellingPendingTx,
  onRefreshPendingTx,
  onCancelPendingTx,
  eip7702Diagnostic,
  onRunEip7702Diagnostic,
  onRunEip7702SendDiagnostic,
}: WalletSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />

      <div className={`relative w-full max-w-2xl ${uiTokens.radius.lg} ${uiTokens.modalSurface} animate-slide-up overflow-hidden`}>
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
            <UiButton onClick={downloadLogs} variant="secondary" size="sm" uppercase className="text-xs">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Logs
            </UiButton>
            <UiButton onClick={onClose} variant="ghost" size="sm" uppercase className="text-xs">
              Close
            </UiButton>
          </div>
        </div>

        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <WalletSettingsOverviewPanel
            connectedWalletAddress={connectedWalletAddress}
            soundSettings={soundSettings}
            onSoundSettingChange={onSoundSettingChange}
            reducedMotion={reducedMotion}
            onReducedMotionChange={onReducedMotionChange}
          />

          <WalletSettings7702Panel
            eip7702Diagnostic={eip7702Diagnostic}
            onRunEip7702Diagnostic={onRunEip7702Diagnostic}
            onRunEip7702SendDiagnostic={onRunEip7702SendDiagnostic}
          />

          <WalletSettingsPendingTxPanel
            pendingTransactionStatus={pendingTransactionStatus}
            isRefreshingPendingTx={isRefreshingPendingTx}
            isCancellingPendingTx={isCancellingPendingTx}
            onRefreshPendingTx={onRefreshPendingTx}
            onCancelPendingTx={onCancelPendingTx}
          />

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
            onDepositEthAmountChange={onDepositEthAmountChange}
            onDepositTokenAmountChange={onDepositTokenAmountChange}
            onDepositEthToEmbedded={onDepositEthToEmbedded}
            onDepositTokenToEmbedded={onDepositTokenToEmbedded}
          />

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
        </div>
      </div>
    </div>
  );
});
