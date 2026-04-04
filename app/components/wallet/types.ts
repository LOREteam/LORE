"use client";

import type { WalletTransfersSummary } from "../../hooks/useWalletTransfers";
import type { UnclaimedWin } from "../../lib/types";
import type { SoundName } from "../../hooks/useSound";
import type { UiButton } from "../ui/UiButton";
import type { PendingTransactionStatus } from "../../hooks/useWalletActions";
import type { Eip7702DiagnosticState } from "../../hooks/usePrivy7702Diagnostics";

export interface WalletSettingsModalProps {
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
  pendingTransactionStatus: PendingTransactionStatus | null;
  isRefreshingPendingTx: boolean;
  isCancellingPendingTx: boolean;
  onRefreshPendingTx: () => void;
  onCancelPendingTx: () => void;
  eip7702Diagnostic: Eip7702DiagnosticState;
  onRunEip7702Diagnostic: () => Promise<void>;
  onRunEip7702SendDiagnostic: () => Promise<void>;
}

export interface TransferRowProps {
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
