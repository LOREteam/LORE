"use client";
import React, { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { MobileTabNav } from "./components/MobileTabNav";
import { PageTabContent } from "./components/PageTabContent";
import { WalletShell } from "./components/WalletShell";
import { OfflineBanner } from "./components/OfflineBanner";
import { NoticeStack } from "./components/NoticeStack";
import { PageBackdrop } from "./components/PageBackdrop";
import { FloatingActions } from "./components/FloatingActions";
import type { LiveStateApiResponse } from "./hooks/useGameLiveStateSnapshot";
import type { RecentWin } from "./hooks/useRecentWins";
import { useLineaOreClientRuntime } from "./hooks/useLineaOreClientRuntime";
import type { TabId } from "./lib/types";

const MAIN_SECTION_LABELS: Record<TabId, string> = {
  hub: "Mining Hub",
  analytics: "Analytics",
  rebate: "Safety Pool",
  leaderboards: "Leaderboards",
  whitepaper: "White Paper",
  faq: "FAQ",
};

const LazyFirstVisitTutorial = dynamic(
  () => import("./components/FirstVisitTutorial").then((mod) => mod.FirstVisitTutorial),
  { ssr: false },
);

interface LineaOreClientProps {
  initialLiveState?: LiveStateApiResponse | null;
  initialNowMs?: number;
  initialRecentWins?: RecentWin[];
}

export default function LineaOreClient({
  initialLiveState = null,
  initialNowMs = 0,
  initialRecentWins = [],
}: LineaOreClientProps) {
  const {
    uiHydrated,
    motionReady,
    reducedMotion,
    notices,
    dismissNotice,
    activeTab,
    handleTabChange,
    realTotalStaked,
    linePath,
    sidebarProps,
    headerProps,
    walletShellProps,
    pageTabContentProps,
    floatingActionsProps,
  } = useLineaOreClientRuntime({
    initialLiveState,
    initialRecentWins,
  });

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);

  return (
    <div
      className="min-h-dvh w-full flex flex-col overflow-x-hidden bg-background text-slate-200 lg:h-screen lg:flex-row lg:overflow-hidden"
      data-ui-hydrated={uiHydrated ? "true" : "false"}
    >
      <NoticeStack notices={notices} onDismiss={dismissNotice} />
      <PageBackdrop motionReady={motionReady} reducedMotion={reducedMotion} />

      <Sidebar {...sidebarProps} mobileOpen={mobileSidebarOpen} onMobileClose={closeMobileSidebar} />

      <main
        aria-label={MAIN_SECTION_LABELS[activeTab]}
        className="relative z-10 flex min-w-0 flex-1 flex-col overflow-visible p-2.5 pb-[calc(6.35rem+env(safe-area-inset-bottom))] md:p-4 md:pb-24 lg:pb-4 lg:overflow-x-hidden lg:overflow-y-auto"
      >
        <OfflineBanner />
        {/* Mobile sidebar toggle */}
        <button
          type="button"
          onClick={openMobileSidebar}
          className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-[#080814]/78 text-slate-300 backdrop-blur-xl transition-colors hover:bg-white/6 hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400 lg:hidden"
          aria-label="Open sidebar menu"
          aria-expanded={mobileSidebarOpen}
          aria-controls="lore-sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <MobileTabNav activeTab={activeTab} onTabChange={handleTabChange} />
        <Header
          initialNowMs={initialNowMs}
          realTotalStaked={realTotalStaked}
          linePath={linePath}
          {...headerProps}
        />

        <WalletShell
          {...walletShellProps}
        />

        <PageTabContent {...pageTabContentProps} />
        <LazyFirstVisitTutorial activeTab={activeTab} onTabChange={handleTabChange} />

      </main>
      <FloatingActions {...floatingActionsProps} />
    </div>
  );
}
