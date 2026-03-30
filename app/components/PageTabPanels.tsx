"use client";

import React from "react";
import dynamic from "next/dynamic";
import { HubContent } from "./HubContent";
import type { Analytics } from "./Analytics";
import type { Leaderboards } from "./Leaderboards";
import type { RebatePanel } from "./RebatePanel";

const TabPanelFallback = () => (
  <div className="rounded-2xl border border-white/[0.08] bg-[#0a0b18]/80 p-6 text-sm text-slate-400">
    Loading panel...
  </div>
);

const LazyAnalytics = dynamic(() => import("./Analytics").then((mod) => mod.Analytics), {
  loading: TabPanelFallback,
});
const LazyRebatePanel = dynamic(() => import("./RebatePanel").then((mod) => mod.RebatePanel), {
  loading: TabPanelFallback,
});
const LazyLeaderboards = dynamic(() => import("./Leaderboards").then((mod) => mod.Leaderboards), {
  loading: TabPanelFallback,
});
const LazyWhitePaper = dynamic(() => import("./WhitePaper").then((mod) => mod.WhitePaper), {
  loading: TabPanelFallback,
});
const LazyFAQ = dynamic(() => import("./FAQ").then((mod) => mod.FAQ), {
  loading: TabPanelFallback,
});

interface PageTabPanelsProps {
  activeTab: string;
  analyticsProps: React.ComponentProps<typeof Analytics>;
  hubProps: React.ComponentProps<typeof HubContent>;
  leaderboardsProps: React.ComponentProps<typeof Leaderboards>;
  rebateProps: React.ComponentProps<typeof RebatePanel>;
}

export function PageTabPanels({
  activeTab,
  analyticsProps,
  hubProps,
  leaderboardsProps,
  rebateProps,
}: PageTabPanelsProps) {
  switch (activeTab) {
    case "hub":
      return <HubContent {...hubProps} />;
    case "analytics":
      return <LazyAnalytics {...analyticsProps} />;
    case "rebate":
      return <LazyRebatePanel {...rebateProps} />;
    case "leaderboards":
      return <LazyLeaderboards {...leaderboardsProps} />;
    case "whitepaper":
      return <LazyWhitePaper />;
    case "faq":
      return <LazyFAQ />;
    default:
      return null;
  }
}
