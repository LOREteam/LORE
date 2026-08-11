import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as analyticsBlockchainHistoryPanelModule from "../app/components/analytics/AnalyticsBlockchainHistoryPanel.tsx";

export function runHistoryPresentationTests() {
  const AnalyticsBlockchainHistoryPanel = analyticsBlockchainHistoryPanelModule.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default?.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default;
  assert.ok(AnalyticsBlockchainHistoryPanel, "blockchain history component export must remain available");
  const analyticsBlockchainHistoryPanelSource = readFileSync("app/components/analytics/AnalyticsBlockchainHistoryPanel.tsx", "utf8");
  assert.match(
    analyticsBlockchainHistoryPanelSource,
    /GRID_SIZE[\s\S]*function parseHistoryWinningTile\(value: string\)[\s\S]*\^\[1-9\]\\d\*\$[\s\S]*Number\.isSafeInteger\(tile\)[\s\S]*tile >= 1 && tile <= GRID_SIZE[\s\S]*const winningTile = parseHistoryWinningTile\(row\.winningTile\)[\s\S]*winningTile !== null/,
    "blockchain history display must reject unsafe or out-of-range winning tile IDs",
  );
  assert.doesNotMatch(
    analyticsBlockchainHistoryPanelSource,
    /Number\(row\.winningTile\)[\s\S]*winBlockNum > 0/,
    "blockchain history display must not use positive-only winning tile parsing",
  );
  const emptyHistoryMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [],
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.match(emptyHistoryMarkup, /No rounds yet/, "empty blockchain history must render an explicit empty state");
  assert.doesNotMatch(emptyHistoryMarkup, /Loading rounds/, "settled empty blockchain history must not look stuck loading");
  const loadingHistoryMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [],
    historyLoading: true,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.match(
    loadingHistoryMarkup,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*Loading rounds/,
    "blockchain history initial loading state must be announced as a polite busy status",
  );
  assert.match(
    loadingHistoryMarkup,
    /aria-hidden="true"[\s\S]*animate-synced-pulse/,
    "blockchain history loading status dots must stay decorative",
  );
  const invalidWinningTileMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [{
      roundId: "77",
      poolDisplay: "10",
      winningTile: "999",
      isResolved: true,
      userWon: true,
      isDailyJackpot: false,
      isWeeklyJackpot: false,
    }],
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.doesNotMatch(
    invalidWinningTileMarkup,
    /Block #999|You won/,
    "blockchain history must not render invalid winning tile rows as user wins",
  );
}
