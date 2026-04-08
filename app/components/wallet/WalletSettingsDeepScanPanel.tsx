"use client";

import React from "react";
import { formatUnits } from "viem";
import type { UnclaimedWin } from "../../lib/types";
import { UiButton } from "../ui/UiButton";
import { UiPanel } from "../ui/UiPanel";

interface WalletSettingsDeepScanPanelProps {
  deepScanWins: UnclaimedWin[] | null;
  deepScanScanning: boolean;
  deepScanClaiming: boolean;
  deepScanProgress: string;
  onDeepScan: () => void;
  onDeepScanStop: () => void;
  onDeepClaimOne: (epochId: string) => void;
  onDeepClaimAll: () => void;
}

export function WalletSettingsDeepScanPanel({
  deepScanWins,
  deepScanScanning,
  deepScanClaiming,
  deepScanProgress,
  onDeepScan,
  onDeepScanStop,
  onDeepClaimOne,
  onDeepClaimAll,
}: WalletSettingsDeepScanPanelProps) {
  return (
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
            {deepScanClaiming ? "Claiming..." : `Claim All (${deepScanWins.length})`}
          </UiButton>
        )}
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        Scans ALL epochs from the start of the contract. Use if you might have unclaimed rewards older than 48 hours.
      </p>

      {deepScanWins === null && !deepScanScanning ? (
        <UiButton onClick={onDeepScan} variant="warning" size="md" uppercase fullWidth className="text-[10px]">
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
          <UiButton onClick={onDeepScanStop} variant="danger" size="sm" uppercase fullWidth className="text-[10px]">
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
          <div className="flex items-center justify-center gap-1.5 py-2 text-gray-400">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[9px] uppercase font-bold tracking-widest">All rewards claimed</span>
          </div>
          <UiButton onClick={onDeepScan} variant="ghost" size="sm" uppercase fullWidth className="text-[10px]">
            Scan Again
          </UiButton>
        </div>
      ) : null}
    </UiPanel>
  );
}
