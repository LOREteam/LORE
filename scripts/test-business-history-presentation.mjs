import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as analyticsBlockchainHistoryPanelModule from "../app/components/analytics/AnalyticsBlockchainHistoryPanel.tsx";

export function runHistoryPresentationTests() {
  const AnalyticsBlockchainHistoryPanel = analyticsBlockchainHistoryPanelModule.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default?.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default;
  assert.ok(AnalyticsBlockchainHistoryPanel, "blockchain history component export must remain available");
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
    historyViewData: ["1e3", "1.5", "0", "26", "9007199254740993"].map((winningTile, index) => ({
      roundId: String(77 + index),
      poolDisplay: "10",
      winningTile,
      isResolved: true,
      userWon: true,
      isDailyJackpot: false,
      isWeeklyJackpot: false,
    })),
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.doesNotMatch(
    invalidWinningTileMarkup,
    /Block #|You won/,
    "blockchain history must reject exponent, fractional, zero, out-of-range, and unsafe winning tiles before rendering a user win",
  );
}
