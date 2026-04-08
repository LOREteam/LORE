import React from "react";
import { cn } from "../../lib/cn";
import { uiTokens } from "./tokens";

type UiButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "success"
  | "danger"
  | "warning"
  | "sky";

type UiButtonSize = "xs" | "sm" | "md";

const variantClasses: Record<UiButtonVariant, string> = {
  primary:
    "border-violet-400/45 bg-violet-500/15 text-violet-200 hover:bg-violet-500/22 hover:shadow-[0_0_16px_rgba(124,58,237,0.2)]",
  secondary:
    "border-violet-500/25 bg-violet-500/10 text-violet-300 hover:bg-violet-500/16 hover:shadow-[0_0_12px_rgba(124,58,237,0.16)]",
  ghost: "border-white/12 bg-white/[0.02] text-slate-300 hover:bg-white/[0.06] hover:text-white",
  success:
    "border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/16 hover:shadow-[0_0_12px_rgba(16,185,129,0.16)]",
  danger:
    "border-red-500/35 bg-red-500/10 text-red-300 hover:bg-red-500/16 hover:shadow-[0_0_12px_rgba(239,68,68,0.15)]",
  warning:
    "border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/16 hover:shadow-[0_0_12px_rgba(245,158,11,0.18)]",
  sky: "border-sky-500/35 bg-sky-500/10 text-sky-300 hover:bg-sky-500/16 hover:shadow-[0_0_12px_rgba(56,189,248,0.16)]",
};

const sizeClasses: Record<UiButtonSize, string> = {
  xs: "px-2.5 py-1 text-[10px] rounded-md",
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export interface UiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: UiButtonVariant;
  size?: UiButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  uppercase?: boolean;
}

export function UiButton({
  variant = "secondary",
  size = "sm",
  fullWidth = false,
  loading = false,
  uppercase = false,
  className,
  disabled,
  children,
  type = "button",
  ...props
}: UiButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 border font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed touch-manipulation select-none",
        uiTokens.focusRing,
        uiTokens.radius.md,
        variantClasses[variant],
        sizeClasses[size],
        uppercase && "uppercase tracking-widest",
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading && (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" className="opacity-30" />
          <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="3.5" className="opacity-90" />
        </svg>
      )}
      {children}
    </button>
  );
}
