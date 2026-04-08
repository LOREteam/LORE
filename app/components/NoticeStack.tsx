"use client";

import React from "react";
import { UiBadge } from "./ui/UiBadge";
import { UiPanel } from "./ui/UiPanel";

export type NoticeTone = "info" | "success" | "warning" | "danger";

export interface NoticeItem {
  id: number;
  message: string;
  tone: NoticeTone;
}

const toneMap: Record<NoticeTone, { panel: React.ComponentProps<typeof UiPanel>["tone"]; badge: React.ComponentProps<typeof UiBadge>["tone"]; label: string }> = {
  info: { panel: "accent", badge: "sky", label: "Info" },
  success: { panel: "success", badge: "success", label: "Success" },
  warning: { panel: "warning", badge: "warning", label: "Warning" },
  danger: { panel: "danger", badge: "danger", label: "Error" },
};

interface NoticeStackProps {
  notices: NoticeItem[];
  onDismiss: (id: number) => void;
}

export function NoticeStack({ notices, onDismiss }: NoticeStackProps) {
  if (notices.length === 0) return null;

  return (
    <div role="status" aria-live="polite" className="fixed right-3 top-3 z-[220] flex w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4 sm:top-4">
      {notices.map((notice) => {
        const tone = toneMap[notice.tone];
        return (
          <UiPanel
            key={notice.id}
            tone={tone.panel}
            padding="sm"
            className="animate-slide-up shadow-2xl shadow-black/30 backdrop-blur-md"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <UiBadge tone={tone.badge} uppercase size="xs" className="mb-2">
                  {tone.label}
                </UiBadge>
                <p className="text-sm leading-relaxed text-slate-100">
                  {notice.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(notice.id)}
                className="shrink-0 rounded-md p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 active:scale-95 focus-visible:ring-2 focus-visible:ring-violet-400"
                aria-label="Dismiss notice"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
          </UiPanel>
        );
      })}
    </div>
  );
}
