import React from "react";
import { cn } from "../../lib/cn";
import { uiTokens } from "./tokens";

type UiInputTone = "default" | "success" | "warning" | "danger";

const toneClasses: Record<UiInputTone, string> = {
  default:
    "border-violet-500/15 focus:border-violet-500/50 focus:shadow-[0_0_12px_rgba(139,92,246,0.12)]",
  success:
    "border-emerald-500/20 focus:border-emerald-500/45 focus:shadow-[0_0_12px_rgba(16,185,129,0.14)]",
  warning:
    "border-amber-500/20 focus:border-amber-500/45 focus:shadow-[0_0_12px_rgba(245,158,11,0.14)]",
  danger: "border-red-500/20 focus:border-red-500/45 focus:shadow-[0_0_12px_rgba(239,68,68,0.14)]",
};

export interface UiInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  tone?: UiInputTone;
}

export function UiInput({ tone = "default", className, ...props }: UiInputProps) {
  return (
    <input
      className={cn(
        uiTokens.inputBase,
        uiTokens.radius.md,
        uiTokens.focusRing,
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
