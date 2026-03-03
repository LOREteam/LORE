import React from "react";
import { cn } from "../../lib/cn";
import { uiTokens } from "./tokens";

type UiPanelTone = "default" | "accent" | "subtle" | "warning" | "danger" | "success";
type UiPanelPadding = "sm" | "md";

const toneClasses: Record<UiPanelTone, string> = {
  default: "border-violet-500/15 bg-[#0a0a16]",
  accent: "border-violet-500/25 bg-violet-500/[0.06]",
  subtle: "border-violet-500/10 bg-[#0a0a16]/80",
  warning: "border-amber-500/20 bg-amber-500/[0.03]",
  danger: "border-red-500/20 bg-red-500/[0.03]",
  success: "border-emerald-500/20 bg-emerald-500/[0.04]",
};

const paddingClasses: Record<UiPanelPadding, string> = {
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
