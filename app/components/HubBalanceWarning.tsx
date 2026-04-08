"use client";

import React from "react";

interface HubBalanceWarningProps {
  lowEthBalance: boolean;
  lowTokenBalance: boolean;
  onDismiss: () => void;
}

export function HubBalanceWarning({
  lowEthBalance,
  lowTokenBalance,
  onDismiss,
}: HubBalanceWarningProps) {
  if (!lowEthBalance && !lowTokenBalance) return null;

  return (
    <div className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-red-400 sm:text-xs sm:tracking-wider">
      <div className="flex min-w-0 items-start gap-2">
        <span className="text-base leading-none">!</span>
        <span className="leading-tight break-words">
          {lowEthBalance && lowTokenBalance
            ? "Privy: low ETH (gas) & LINEA token"
            : lowEthBalance
              ? "Privy: low ETH - not enough for gas"
              : "Privy: low LINEA token balance"}
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss warning"
        className="mt-0.5 shrink-0 text-sm leading-none text-red-400/60 hover:text-red-300"
      >
        x
      </button>
    </div>
  );
}
