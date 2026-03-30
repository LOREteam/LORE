"use client";

import React from "react";
import { HubBalanceWarning } from "./HubBalanceWarning";
import { PageTabPanels } from "./PageTabPanels";
import type { Analytics } from "./Analytics";
import type { HubContent } from "./HubContent";
import type { Leaderboards } from "./Leaderboards";
import type { RebatePanel } from "./RebatePanel";

interface PageTabContentProps {
  activeTab: string;
  analyticsProps: React.ComponentProps<typeof Analytics>;
  hubProps: React.ComponentProps<typeof HubContent>;
  leaderboardsProps: React.ComponentProps<typeof Leaderboards>;
  rebateProps: React.ComponentProps<typeof RebatePanel>;
  lowEthBalance: boolean;
  lowTokenBalance: boolean;
  balanceWarningDismissed: boolean;
  onDismissBalanceWarning: () => void;
}

export function PageTabContent({
  activeTab,
  analyticsProps,
  hubProps,
  leaderboardsProps,
  rebateProps,
  lowEthBalance,
  lowTokenBalance,
  balanceWarningDismissed,
  onDismissBalanceWarning,
}: PageTabContentProps) {
  const showHubBalanceWarning =
    activeTab === "hub" && !balanceWarningDismissed && (lowEthBalance || lowTokenBalance);

  return (
    <>
      {showHubBalanceWarning && (
        <HubBalanceWarning
          lowEthBalance={lowEthBalance}
          lowTokenBalance={lowTokenBalance}
          onDismiss={onDismissBalanceWarning}
        />
      )}

      <PageTabPanels
        activeTab={activeTab}
        analyticsProps={analyticsProps}
        hubProps={hubProps}
        leaderboardsProps={leaderboardsProps}
        rebateProps={rebateProps}
      />
    </>
  );
}
