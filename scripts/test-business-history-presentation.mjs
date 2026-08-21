import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as analyticsBlockchainHistoryPanelModule from "../app/components/analytics/AnalyticsBlockchainHistoryPanel.tsx";
import * as analyticsDepositsPanelModule from "../app/components/analytics/AnalyticsDepositsPanel.tsx";

export function runHistoryPresentationTests() {
  const AnalyticsBlockchainHistoryPanel = analyticsBlockchainHistoryPanelModule.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default?.AnalyticsBlockchainHistoryPanel
    ?? analyticsBlockchainHistoryPanelModule.default;
  assert.ok(AnalyticsBlockchainHistoryPanel, "blockchain history component export must remain available");
  const AnalyticsDepositsPanel = analyticsDepositsPanelModule.AnalyticsDepositsPanel
    ?? analyticsDepositsPanelModule.default?.AnalyticsDepositsPanel
    ?? analyticsDepositsPanelModule.default;
  assert.ok(AnalyticsDepositsPanel, "deposit history component export must remain available");
  const deposit = {
    epoch: "42",
    tileIds: [1],
    amounts: [1],
    amount: "1.00",
    amountNum: 1,
    txHash: `0x${"ab".repeat(32)}`,
    blockNumber: "7",
    blockNumberNum: 7,
    winningTile: null,
    isDailyJackpot: false,
    isWeeklyJackpot: false,
    reward: null,
  };
  const depositPanelProps = {
    depositsLoading: false,
    depositsRefreshing: false,
    depositsMetadataLoading: false,
    depositsLastLoadedAt: null,
    newDepositIds: new Set(),
    onLoadDeposits: () => {},
    onRefreshDeposits: () => {},
    showMore: () => {},
    totalDeposited: 0,
    visibleCount: 0,
    visibleDeposits: [],
    hasMore: false,
  };
  const unavailableDepositMarkup = renderToStaticMarkup(createElement(AnalyticsDepositsPanel, {
    ...depositPanelProps,
    deposits: null,
    depositsError: "safe error",
  }));
  assert.match(unavailableDepositMarkup, /Unable to load deposit history/, "failed first deposit read must be explicit");
  assert.doesNotMatch(unavailableDepositMarkup, /Load History/, "failed first deposit read must not become an empty history");
  const staleDepositMarkup = renderToStaticMarkup(createElement(AnalyticsDepositsPanel, {
    ...depositPanelProps,
    deposits: [deposit],
    depositsError: "safe error",
    depositsLastLoadedAt: 1_000,
    totalDeposited: 1,
    visibleCount: 1,
    visibleDeposits: [deposit],
  }));
  assert.match(staleDepositMarkup, /Showing the last verified deposit history/, "failed refresh must retain the verified deposit snapshot");
  assert.match(staleDepositMarkup, /#42/, "failed refresh must keep the verified deposit rows visible");
  const emptyHistoryMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [],
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.match(emptyHistoryMarkup, /No rounds yet/, "empty blockchain history must render an explicit empty state");
  assert.doesNotMatch(emptyHistoryMarkup, /Loading rounds/, "settled empty blockchain history must not look stuck loading");
  const unavailableHistoryMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [],
    historyError: "safe error",
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.match(unavailableHistoryMarkup, /Unable to load blockchain history/, "failed round RPC read must be explicit");
  assert.doesNotMatch(unavailableHistoryMarkup, /No rounds yet/, "failed round RPC read must not become an empty history");
  const staleHistoryMarkup = renderToStaticMarkup(createElement(AnalyticsBlockchainHistoryPanel, {
    historyViewData: [{
      roundId: "42",
      poolDisplay: "1.00",
      winningTile: "1",
      isResolved: true,
      userWon: false,
      isDailyJackpot: false,
      isWeeklyJackpot: false,
    }],
    historyError: "safe error",
    historyLoading: false,
    historyRefreshing: false,
    newHistoryIds: new Set(),
  }));
  assert.match(staleHistoryMarkup, /Showing the last verified blockchain history/, "failed refresh must retain the verified round snapshot");
  assert.match(staleHistoryMarkup, /#42/, "failed refresh must keep the verified round rows visible");
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
