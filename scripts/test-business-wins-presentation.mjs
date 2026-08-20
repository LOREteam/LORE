import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as winsTickerModule from "../app/components/WinsTicker.tsx";
import * as leaderboardsModule from "../app/components/Leaderboards.tsx";

const winsTicker = winsTickerModule.default ?? winsTickerModule;
const WinsTicker = winsTicker.WinsTicker;
const Leaderboards = leaderboardsModule.Leaderboards ?? leaderboardsModule.default?.Leaderboards ?? leaderboardsModule.default;

const leaderboardData = {
  biggestSingleWin: [{ rank: 1, address: "0x1234567890abcdef1234567890abcdef12345678", value: "10", valueNum: 10 }],
  luckiest: [],
  oneTileWonder: [],
  mostWins: [],
  whales: [],
  underdog: [],
  luckyTile: [{ tileId: 1, wins: 2, pct: 12.345 }],
};

export function runWinsPresentationTests() {
  const recentWinsApiSource = readFileSync("app/api/recent-wins/data.ts", "utf8");
  assert.ok(WinsTicker, "wins ticker component export must remain available");
  assert.ok(Leaderboards, "leaderboards component export must remain available");
  const unsafeBigintAmountMarkup = renderToStaticMarkup(React.createElement(WinsTicker, {
    wins: [{
      epoch: "7",
      user: "0x1234567890abcdef1234567890abcdef12345678",
      amount: "1000000000000000000500000",
      jackpotKind: null,
    }],
    reducedMotion: true,
  }));
  assert.match(
    unsafeBigintAmountMarkup,
    /\+1000000000000000001M/,
    "wins ticker must preserve an unsafe integer's half-million rounding boundary without Number coercion",
  );
  assert.match(unsafeBigintAmountMarkup, /title="Epoch #7, \+1000000000000000000500000 LINEA, 0x1234…5678"/, "wins ticker tooltip must use the same shortened wallet label as its visible chip");
  assert.doesNotMatch(unsafeBigintAmountMarkup, /0x1234567890abcdef1234567890abcdef12345678/, "wins ticker must not expose a full wallet address in its feed or tooltip");
  const renderedLeaderboards = renderToStaticMarkup(React.createElement(Leaderboards, {
    data: leaderboardData,
    loading: false,
    error: null,
    refetch: () => {},
  }));
  assert.match(renderedLeaderboards, /title="0x1234\.\.\.5678"/, "leaderboard rows must keep wallet addresses shortened in hover text");
  assert.doesNotMatch(renderedLeaderboards, /title="0x1234567890abcdef1234567890abcdef12345678"/, "leaderboard tooltips must not expose full wallet addresses");
  assert.match(renderedLeaderboards, /12\.3%/, "lucky-tile percentages must use bounded one-decimal formatting");
  const loadingLeaderboards = renderToStaticMarkup(React.createElement(Leaderboards, {
    data: null,
    loading: true,
    error: null,
    refetch: () => {},
  }));
  assert.match(loadingLeaderboards, /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"/, "leaderboards loading state must be a polite busy status");
  assert.match(loadingLeaderboards, /<svg aria-hidden="true"/, "leaderboards loading spinner must remain decorative");
  const erroredLeaderboards = renderToStaticMarkup(React.createElement(Leaderboards, {
    data: null,
    loading: false,
    error: "Index is unavailable",
    refetch: () => {},
  }));
  assert.match(erroredLeaderboards, /role="alert"[\s\S]*Index is unavailable[\s\S]*Retry/, "leaderboard errors must remain an alert with recovery action");
  assert.doesNotMatch(
    recentWinsApiSource,
    /BigInt\([^)]*blockNumber\s*\|\|\s*"0"\)/,
    "recent wins API must not call BigInt directly on stored blockNumber strings",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "recent wins API must not sort using unchecked stored epoch numbers",
  );
}
