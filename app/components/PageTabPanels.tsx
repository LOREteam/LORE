"use client";

import React from "react";
import dynamic from "next/dynamic";
import { HubContent } from "./HubContent";
import { FAQ } from "./FAQ";
import { Leaderboards } from "./Leaderboards";
import { WhitePaper } from "./WhitePaper";
import type { Analytics } from "./Analytics";
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
const loadRebatePanel = () => loadStaticTabWithRetry(() => import("./RebatePanel")).then((mod) => mod.RebatePanel);

const LazyAnalytics = dynamic(loadAnalytics, {
  loading: TabPanelFallback,
});
const LazyRebatePanel = dynamic(loadRebatePanel, {
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
      activePanel = <Leaderboards {...leaderboardsProps} />;
      break;
    case "whitepaper":
      activePanel = <WhitePaper />;
      break;
    case "faq":
      activePanel = <FAQ />;
      break;
    default:
      activePanel = null;
      break;
  }

  return <>{activePanel}</>;
});
