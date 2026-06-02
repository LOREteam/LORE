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
  | "sky"
  | "locked"
  | "pending";

type UiButtonSize = "xs" | "sm" | "md";

const variantClasses: Record<UiButtonVariant, string> = {
  primary:
    "border-violet-500/40 bg-linear-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-600/20 hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30",
  secondary:
    "border-violet-500/25 bg-violet-500/10 text-violet-300 hover:bg-violet-500/16 hover:shadow-[0_0_12px_rgba(124,58,237,0.16)]",
  ghost: "border-white/12 bg-white/2 text-slate-300 hover:bg-white/6 hover:text-white",
  success:
    "border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/16 hover:shadow-[0_0_12px_rgba(16,185,129,0.16)]",
  danger:
    "border-red-500/35 bg-red-500/10 text-red-300 hover:bg-red-500/16 hover:shadow-[0_0_12px_rgba(239,68,68,0.15)]",
  warning:
    "border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/16 hover:shadow-[0_0_12px_rgba(245,158,11,0.18)]",
  sky: "border-sky-500/35 bg-sky-500/10 text-sky-300 hover:bg-sky-500/16 hover:shadow-[0_0_12px_rgba(56,189,248,0.16)]",
  locked: "border-white/5 bg-[#13132a] text-gray-400 hover:bg-[#16162f]",
  pending:
    "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/14 hover:shadow-[0_0_12px_rgba(245,158,11,0.14)]",
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
