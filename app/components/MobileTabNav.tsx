"use client";

import React from "react";
import type { TabId } from "../lib/types";

const MOBILE_TABS: readonly TabId[] = ["hub", "analytics", "rebate", "leaderboards", "whitepaper", "faq"];

interface MobileTabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

function getTabMeta(tab: TabId) {
  if (tab === "hub") {
    return {
      label: "Hub",
      icon: (
        <path
          d="M4 10.5L12 4l8 6.5M6.5 9.5V19h11V9.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ),
    };
  }

  if (tab === "analytics") {
    return {
      label: "Analytics",
      icon: (
        <>
          <path d="M5 18V11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M10 18V7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M15 18v-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M20 18V4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </>
      ),
    };
  }

  if (tab === "rebate") {
    return {
      label: "Rebate",
      icon: (
        <>
          <path d="M12 3.75V7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M12 16.5v3.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M20.25 12H16.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M7.5 12H3.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.75" />
        </>
      ),
    };
  }

  if (tab === "leaderboards") {
    return {
      label: "Top",
      icon: (
        <>
          <path d="M6 18.5h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M8 18.5v-5h3.2v5" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M12.8 18.5V10.5H16v8" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M4.8 18.5v-2.5H8v2.5" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        </>
      ),
    };
  }

  if (tab === "whitepaper") {
    return {
      label: "White paper",
      icon: (
        <>
          <path d="M6 5.5h8.75a3.25 3.25 0 0 1 3.25 3.25v8.75H9.25A3.25 3.25 0 0 0 6 20.75V5.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M18 5.5H9.25A3.25 3.25 0 0 0 6 8.75v8.75h8.75A3.25 3.25 0 0 0 18 20.75V5.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        </>
      ),
    };
  }

  return {
    label: "FAQ",
    icon: (
      <>
        <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.75" />
        <path d="M9.75 9.25a2.5 2.5 0 1 1 4.1 1.95c-.8.62-1.35 1.04-1.35 2.05" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="16.6" r="0.95" fill="currentColor" />
      </>
    ),
  };
}

export function MobileTabNav({ activeTab, onTabChange }: MobileTabNavProps) {
  return (
    <div className="sticky top-2 z-30 -mx-1 mb-3 lg:hidden">
      <div className="no-scrollbar overflow-x-auto px-1 pb-1">
        <div className="inline-flex min-w-full items-center gap-1.5 rounded-2xl border border-white/[0.07] bg-[#080814]/78 p-1.5 shadow-[0_12px_30px_rgba(2,6,23,0.28)] backdrop-blur-xl">
          {MOBILE_TABS.map((tab) => {
            const { label, icon } = getTabMeta(tab);
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                aria-current={active ? "page" : undefined}
                className={`group flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-all duration-200 ${
                  active
                    ? "border-violet-400/35 bg-gradient-to-r from-violet-500/24 via-violet-500/18 to-sky-500/18 text-violet-100 shadow-[0_0_0_1px_rgba(167,139,250,0.12),0_10px_24px_rgba(76,29,149,0.18)]"
                    : "border-white/[0.05] bg-white/[0.02] text-slate-400 hover:border-white/[0.1] hover:bg-white/[0.04] hover:text-slate-200"
                }`}
                title={label}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform duration-200 ${active ? "scale-105" : "group-hover:scale-105"}`}
                >
                  {icon}
                </svg>
                <span className="whitespace-nowrap leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
