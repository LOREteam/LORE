"use client";
import React from "react";
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
    chartHasData,
    sidebarProps,
    headerProps,
    walletShellProps,
    pageTabContentProps,
    floatingActionsProps,
  } = useLineaOreClientRuntime({
    initialLiveState,
    initialRecentWins,
  });

  return (
    <div
      className="min-h-dvh w-full flex flex-col overflow-x-hidden bg-[#060612] text-slate-200 lg:h-screen lg:flex-row lg:overflow-hidden"
      data-ui-hydrated={uiHydrated ? "true" : "false"}
    >
      <NoticeStack notices={notices} onDismiss={dismissNotice} />
      <PageBackdrop motionReady={motionReady} reducedMotion={reducedMotion} />

      <Sidebar {...sidebarProps} />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-visible p-3 pb-20 animate-fade-in md:p-4 md:pb-24 lg:pb-4 lg:overflow-x-hidden lg:overflow-y-auto">
        <OfflineBanner />
        <MobileTabNav activeTab={activeTab} onTabChange={handleTabChange} />
        <Header
          initialNowMs={initialNowMs}
          realTotalStaked={realTotalStaked}
          linePath={linePath}
          chartHasData={chartHasData}
          {...headerProps}
        />

        <WalletShell
          {...walletShellProps}
        />

        <PageTabContent {...pageTabContentProps} />

      </main>
      <FloatingActions {...floatingActionsProps} />
    </div>
  );
}
