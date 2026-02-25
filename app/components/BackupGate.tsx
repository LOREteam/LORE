"use client";

import React, { useCallback, useState } from "react";

const STORAGE_KEY = "lineaore:privy-backup-confirmed";

export function getBackupConfirmedAddress(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setBackupConfirmed(address: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, address.toLowerCase());
  } catch {
    /* ignore */
  }
}

export function isBackupConfirmedFor(embeddedWalletAddress: string | null): boolean {
  if (!embeddedWalletAddress) return true;
  const confirmed = getBackupConfirmedAddress();
  return confirmed === embeddedWalletAddress.toLowerCase();
}

interface BackupGateProps {
  embeddedWalletAddress: string | null;
  onExportPrivateKey: () => void | Promise<void>;
  onConfirm: () => void;
}

export function BackupGate({
  embeddedWalletAddress,
  onExportPrivateKey,
  onConfirm,
}: BackupGateProps) {
  const [checked, setChecked] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await onExportPrivateKey();
    } finally {
      setIsExporting(false);
    }
  }, [onExportPrivateKey]);

  const handleContinue = useCallback(() => {
    if (!embeddedWalletAddress || !checked) return;
    setBackupConfirmed(embeddedWalletAddress);
    onConfirm();
  }, [embeddedWalletAddress, checked, onConfirm]);

  if (!embeddedWalletAddress) return null;
  if (isBackupConfirmedFor(embeddedWalletAddress)) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md rounded-2xl border-2 border-amber-500/40 bg-[#0d0d1a] shadow-2xl shadow-amber-500/10 overflow-hidden animate-slide-up">
        <div className="p-6 sm:p-8 space-y-5">
          <div className="flex items-center justify-center gap-2 text-amber-400">
            <svg className="w-10 h-10 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <h2 className="text-xl font-black uppercase tracking-wider text-white">
              Save your wallet
            </h2>
          </div>

          <p className="text-sm text-gray-300 leading-relaxed text-center">
            Your Privy wallet holds your funds. If you lose access (clear data, new device), <span className="text-amber-300 font-semibold">only a backup of your private key</span> will restore it. We cannot recover it for you.
          </p>

          <p className="text-xs text-gray-500 text-center">
            Export the key, copy it to a safe place (password manager or paper), then confirm below.
          </p>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="w-full px-4 py-3 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 text-amber-300 font-bold uppercase tracking-widest text-sm hover:bg-amber-500/20 hover:border-amber-400/60 transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isExporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Opening…
                </>
              ) : (
                <>Export private key</>
              )}
            </button>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-2 border-amber-500/50 bg-black/30 text-amber-500 focus:ring-amber-500/50"
              />
              <span className="text-xs text-gray-400 group-hover:text-gray-300">
                I have copied or saved my private key in a safe place and understand that without it I can lose access to my funds.
              </span>
            </label>

            <button
              type="button"
              onClick={handleContinue}
              disabled={!checked}
              className="w-full px-4 py-3 rounded-xl bg-emerald-500/20 border-2 border-emerald-500/50 text-emerald-300 font-bold uppercase tracking-widest text-sm hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
            >
              I&apos;ve saved it, continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
