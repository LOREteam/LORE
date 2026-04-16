"use client";

import React from "react";
import dynamic from "next/dynamic";
import { HubContent } from "./HubContent";
import { Analytics } from "./Analytics";
import { Leaderboards } from "./Leaderboards";
import { RebatePanel } from "./RebatePanel";
import { isChunkLoadLikeErrorMessage } from "../lib/chunkReloadRecovery";

const TabPanelFallback = () => (
  <div className="rounded-2xl border border-white/[0.08] bg-[#0a0b18]/80 p-6 text-sm text-slate-400">
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

const loadWhitePaper = () => loadStaticTabWithRetry(() => import("./WhitePaper")).then((mod) => mod.WhitePaper);
const loadFAQ = () => loadStaticTabWithRetry(() => import("./FAQ")).then((mod) => mod.FAQ);

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
      activePanel = <Analytics {...analyticsProps} />;
      break;
    case "rebate":
      activePanel = <RebatePanel {...rebateProps} />;
      break;
    case "leaderboards":
      activePanel = <Leaderboards {...leaderboardsProps} />;
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
