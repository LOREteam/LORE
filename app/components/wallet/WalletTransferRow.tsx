"use client";

import React from "react";
import { UiButton } from "../ui/UiButton";
import { UiInput } from "../ui/UiInput";
import type { TransferRowProps } from "./types";

const transferBadgeVariantClasses: Record<NonNullable<TransferRowProps["assetVariant"]>, string> = {
  primary: "border-violet-400/45 bg-violet-500/15 text-violet-200",
  secondary: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  ghost: "border-white/12 bg-white/2 text-slate-300",
  success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  danger: "border-red-500/35 bg-red-500/10 text-red-300",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-300",
  sky: "border-sky-500/35 bg-sky-500/10 text-sky-300",
  locked: "border-white/5 bg-[#13132a] text-gray-400",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

export interface WalletTransferRowPresentation {
  state: "ready" | "unavailable" | "pending";
  actionLabel: string;
  buttonText: string;
  announce: boolean;
}

export function getWalletTransferRowPresentation(
  buttonLabel: string,
  disabled: boolean,
  loading: boolean,
): WalletTransferRowPresentation {
  if (loading) {
    return {
      state: "pending",
      actionLabel: `${buttonLabel} in progress`,
      buttonText: "Sending...",
      announce: true,
    };
  }
  if (disabled) {
    return {
      state: "unavailable",
      actionLabel: `${buttonLabel} unavailable`,
      buttonText: buttonLabel,
      announce: false,
    };
  }
  return {
    state: "ready",
    actionLabel: buttonLabel,
    buttonText: buttonLabel,
    announce: false,
  };
}

export const WalletTransferRow = React.memo(function WalletTransferRow({
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
  const presentation = getWalletTransferRowPresentation(buttonLabel, disabled, loading);

  return (
    <div
      className="grid grid-cols-[4rem_minmax(0,1fr)_7.5rem] items-center gap-1.5"
      data-transfer-action-state={presentation.state}
    >
      {presentation.announce && (
        <span className="sr-only" role="status" aria-live="polite">
          {presentation.actionLabel}
        </span>
      )}
      <div
        className={`flex h-8 items-center justify-center rounded-lg border px-2 text-[10px] font-semibold uppercase tracking-widest shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${transferBadgeVariantClasses[assetVariant]}`}
      >
        <span className="block w-full text-center leading-none">{assetLabel}</span>
      </div>
      <UiInput
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 20))}
        maxLength={20}
        className="lore-nums h-8 min-w-0 px-4 py-1.5 text-sm"
        placeholder={placeholder}
        aria-label={`${assetLabel} transfer amount`}
      />
      <UiButton
        onClick={onSubmit}
        disabled={disabled}
        variant={buttonVariant}
        size="sm"
        uppercase
        loading={loading}
        className="h-8 w-full px-3 text-[10px]"
        aria-label={presentation.actionLabel}
        title={presentation.actionLabel}
      >
        {presentation.buttonText}
      </UiButton>
    </div>
  );
});
