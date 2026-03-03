import React from "react";
import { cn } from "../../lib/cn";
import { uiTokens } from "./tokens";

type UiBadgeTone =
  | "default"
  | "violet"
  | "sky"
  | "amber"
  | "emerald"
  | "fuchsia"
  | "danger"
  | "success"
  | "warning";

type UiBadgeSize = "xs" | "sm";

const toneClasses: Record<UiBadgeTone, string> = {
  default: "border-white/12 bg-white/[0.02] text-slate-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  amber: "border-amber-500/30 bg-amber-500/12 text-amber-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/12 text-fuchsia-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/12 text-amber-300",
};

const sizeClasses: Record<UiBadgeSize, string> = {
  xs: "px-1.5 py-0.5 text-xs",
  sm: "px-2 py-1 text-[11px]",
};

export interface UiBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: UiBadgeTone;
  size?: UiBadgeSize;
  uppercase?: boolean;
  dot?: boolean;
  pulseDot?: boolean;
  pill?: boolean;
}

export function UiBadge({
  tone = "default",
  size = "xs",
  uppercase = false,
  dot = false,
  pulseDot = false,
  pill = false,
  className,
  children,
  ...props
}: UiBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border font-bold",
        pill ? "rounded-full" : uiTokens.radius.sm,
        toneClasses[tone],
        sizeClasses[size],
        uppercase && "uppercase tracking-wider",
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current opacity-90",
            pulseDot && "animate-synced-pulse",
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
