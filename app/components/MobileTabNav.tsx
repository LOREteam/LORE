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
      title: "Hub",
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
      label: "Stats",
      title: "Analytics",
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
      title: "Rebate",
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
      title: "Leaderboards",
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
      label: "Paper",
      title: "White paper",
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
    title: "FAQ",
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
    <div className="lg:hidden">
      <div className="mobile-hud-nav fixed left-2 right-12 z-[180] sm:left-4 sm:right-[5.25rem]">
        <div className="no-scrollbar overflow-x-auto overscroll-x-contain">
        <nav
          aria-label="Primary sections"
          className="inline-flex min-w-full snap-x snap-mandatory scroll-px-1 items-center justify-between gap-1 rounded-2xl border border-white/8 bg-[#070711]/90 p-1 shadow-[0_12px_30px_rgba(2,6,23,0.38)] backdrop-blur-xl"
        >
          {MOBILE_TABS.map((tab) => {
            const { label, title, icon } = getTabMeta(tab);
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                aria-pressed={active}
                className={`group flex h-10 min-w-10 flex-1 shrink-0 snap-start items-center justify-center gap-1.5 rounded-xl border px-2 text-[9px] font-semibold uppercase tracking-[0.1em] transition-all duration-200 active:scale-95 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${
                  active
                    ? "border-violet-400/35 bg-linear-to-r from-violet-500/26 via-violet-500/18 to-sky-500/18 text-violet-100 shadow-[0_0_0_1px_rgba(167,139,250,0.12),0_8px_18px_rgba(76,29,149,0.18)]"
                    : "border-white/5 bg-white/2 text-slate-400 hover:border-white/10 hover:bg-white/4 hover:text-slate-200"
                }`}
                title={title}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 transition-transform duration-200 ${active ? "scale-105" : "group-hover:scale-105"}`}
                >
                  {icon}
                </svg>
                <span className="hidden whitespace-nowrap leading-none min-[430px]:inline">{label}</span>
              </button>
            );
          })}
        </nav>
        </div>
      </div>
    </div>
  );
}
