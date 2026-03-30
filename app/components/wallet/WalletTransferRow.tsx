"use client";

import React from "react";
import { UiButton } from "../ui/UiButton";
import { UiInput } from "../ui/UiInput";
import type { TransferRowProps } from "./types";

const transferBadgeVariantClasses: Record<NonNullable<TransferRowProps["assetVariant"]>, string> = {
  primary: "border-violet-400/45 bg-violet-500/15 text-violet-200",
  secondary: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  ghost: "border-white/12 bg-white/[0.02] text-slate-300",
  success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  danger: "border-red-500/35 bg-red-500/10 text-red-300",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-300",
  sky: "border-sky-500/35 bg-sky-500/10 text-sky-300",
};

export function WalletTransferRow({
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
        <span className="block w-full text-center leading-none">{assetLabel}</span>
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
        {loading ? "Sending..." : buttonLabel}
      </UiButton>
    </div>
  );
}
