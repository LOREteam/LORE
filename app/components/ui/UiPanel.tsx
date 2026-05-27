import React from "react";
import { cn } from "../../lib/cn";
import { uiTokens } from "./tokens";

type UiPanelTone = "default" | "accent" | "subtle" | "warning" | "danger" | "success";
type UiPanelPadding = "xs" | "sm" | "md";

const toneClasses: Record<UiPanelTone, string> = {
  default: "border-violet-500/15 bg-surface",
  accent: "border-violet-500/25 bg-violet-500/6",
  subtle: "border-violet-500/10 bg-surface/80",
  warning: "border-amber-500/20 bg-amber-500/3",
  danger: "border-red-500/20 bg-red-500/3",
  success: "border-emerald-500/20 bg-emerald-500/4",
};

const paddingClasses: Record<UiPanelPadding, string> = {
  xs: "p-2.5",
  sm: "p-3",
  md: "p-4",
};

export interface UiPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: UiPanelTone;
  padding?: UiPanelPadding;
}

export function UiPanel({
  tone = "default",
  padding = "md",
  className,
  children,
  ...props
}: UiPanelProps) {
  return (
    <div
      className={cn(
        uiTokens.panelBase,
        uiTokens.radius.md,
        toneClasses[tone],
        paddingClasses[padding],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
