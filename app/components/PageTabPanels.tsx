"use client";

import React from "react";
import dynamic from "next/dynamic";
import { HubContent } from "./HubContent";
import type { Analytics } from "./Analytics";
import type { Leaderboards } from "./Leaderboards";
import type { RebatePanel } from "./RebatePanel";
import { isChunkLoadLikeErrorMessage } from "../lib/chunkReloadRecovery";

const TabPanelFallback = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="rounded-2xl border border-white/8 bg-[#0a0b18]/80 p-6 text-sm text-slate-400"
  >
    Loading panel...
  </div>
);

async function loadStaticTabWithRetry<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const isChunkLoadError = isChunkLoadLikeErrorMessage(message);
    if (!isChunkLoadError || typeof window === "undefined") {
      throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    return loader();
  }
}

const loadAnalytics = () => loadStaticTabWithRetry(() => import("./Analytics")).then((mod) => mod.Analytics);
const loadLeaderboards = () => loadStaticTabWithRetry(() => import("./Leaderboards")).then((mod) => mod.Leaderboards);
const loadRebatePanel = () => loadStaticTabWithRetry(() => import("./RebatePanel")).then((mod) => mod.RebatePanel);
const loadWhitePaper = () => loadStaticTabWithRetry(() => import("./WhitePaper")).then((mod) => mod.WhitePaper);
const loadFAQ = () => loadStaticTabWithRetry(() => import("./FAQ")).then((mod) => mod.FAQ);

const LazyAnalytics = dynamic(loadAnalytics, {
  loading: TabPanelFallback,
});
const LazyLeaderboards = dynamic(loadLeaderboards, {
  loading: TabPanelFallback,
});
const LazyRebatePanel = dynamic(loadRebatePanel, {
  loading: TabPanelFallback,
});
const LazyWhitePaper = dynamic(loadWhitePaper, {
  loading: TabPanelFallback,
});
const LazyFAQ = dynamic(loadFAQ, {
  loading: TabPanelFallback,
});

interface PageTabPanelsProps {
  activeTab: string;
  analyticsProps: React.ComponentProps<typeof Analytics>;
  hubProps: React.ComponentProps<typeof HubContent>;
  leaderboardsProps: React.ComponentProps<typeof Leaderboards>;
  rebateProps: React.ComponentProps<typeof RebatePanel>;
}

export const PageTabPanels = React.memo(function PageTabPanels({
  activeTab,
  analyticsProps,
  hubProps,
  leaderboardsProps,
  rebateProps,
}: PageTabPanelsProps) {
  let activePanel: React.ReactNode = null;
  switch (activeTab) {
    case "hub":
      activePanel = <HubContent {...hubProps} />;
      break;
    case "analytics":
      activePanel = <LazyAnalytics {...analyticsProps} />;
      break;
    case "rebate":
      activePanel = <LazyRebatePanel {...rebateProps} />;
      break;
    case "leaderboards":
      activePanel = <LazyLeaderboards {...leaderboardsProps} />;
      break;
    case "whitepaper":
      activePanel = <LazyWhitePaper />;
      break;
    case "faq":
      activePanel = <LazyFAQ />;
      break;
    default:
      activePanel = null;
      break;
  }

  return <>{activePanel}</>;
});
