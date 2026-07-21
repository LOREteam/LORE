import React from "react";
import { cn } from "../../lib/cn";
import { uiTokens } from "./tokens";

type UiTableTone = "violet" | "sky" | "amber";

const frameToneClasses: Record<UiTableTone, string> = {
  violet: "border-violet-500/15",
  sky: "border-sky-500/15",
  amber: "border-amber-500/15",
};

export interface UiTableProps extends React.HTMLAttributes<HTMLDivElement> {
  "aria-label": string;
  tone?: UiTableTone;
  maxHeightClass?: string;
}

export function UiTable({
  tone = "violet",
  maxHeightClass,
  className,
  children,
  ...props
}: UiTableProps) {
  return (
    <div
      role="region"
      tabIndex={0}
      className={cn(
        "overflow-x-auto overflow-y-auto border",
        uiTokens.radius.sm,
        frameToneClasses[tone],
        maxHeightClass,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function UiTableHead({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-10 bg-surface text-xs font-bold uppercase tracking-widest text-gray-300",
        className,
      )}
      {...props}
    >
      {children}
    </thead>
  );
}

export function UiTableBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn("divide-y divide-white/4", className)} {...props}>
      {children}
    </tbody>
  );
}

export interface UiTableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  index: number;
  isNew?: boolean;
}

export function UiTableRow({
  index,
  isNew = false,
  className,
  children,
  ...props
}: UiTableRowProps) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-white/2",
        index % 2 === 0 ? "bg-surface-raised" : "bg-surface/50",
        isNew && "animate-row-enter",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}
