"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { BackupGate } from "./BackupGate";
import type { WalletSettingsModal } from "./WalletSettingsModal";

const LazyBackupGate = dynamic(() => import("./BackupGate").then((mod) => mod.BackupGate));
const LazyWalletSettingsModal = dynamic(() => import("./WalletSettingsModal").then((mod) => mod.WalletSettingsModal));

interface WalletShellProps {
  backupGateVersion: number;
  backupProps: Omit<React.ComponentProps<typeof BackupGate>, "key">;
  showBackupGate: boolean;
  showWalletSettings: boolean;
  walletSettingsProps: React.ComponentProps<typeof WalletSettingsModal>;
}

export function WalletShell({
  backupGateVersion,
  backupProps,
  showBackupGate,
  showWalletSettings,
  walletSettingsProps,
}: WalletShellProps) {
  return (
    <>
      {showWalletSettings && <LazyWalletSettingsModal {...walletSettingsProps} />}
      {showBackupGate && <LazyBackupGate key={backupGateVersion} {...backupProps} />}
    </>
  );
}
