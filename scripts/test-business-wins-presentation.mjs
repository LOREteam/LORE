import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as winsTickerModule from "../app/components/WinsTicker.tsx";

const winsTicker = winsTickerModule.default ?? winsTickerModule;
const WinsTicker = winsTicker.WinsTicker;

export function runWinsPresentationTests() {
  const recentWinsApiSource = readFileSync("app/api/recent-wins/data.ts", "utf8");
  const winsTickerSource = readFileSync("app/components/WinsTicker.tsx", "utf8");
  assert.match(
    winsTickerSource,
    /const userLabel = shortenAddr\(w\.user\)[\s\S]*title=\{`Epoch #\$\{w\.epoch\}, \+\$\{w\.amount\} LINEA, \$\{userLabel\}`\}/,
    "wins ticker tooltip must use the same shortened user label as the visible feed chip",
  );
  assert.ok(WinsTicker, "wins ticker component export must remain available");
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
  const leaderboardsTooltipSource = readFileSync("app/components/Leaderboards.tsx", "utf8");
  assert.match(
    leaderboardsTooltipSource,
    /const addressLabel = shortenAddress\(e\.address\)[\s\S]*title=\{addressLabel\}/,
    "leaderboard rows must not place full wallet addresses in hover text",
  );
  assert.match(
    leaderboardsTooltipSource,
    /loading &&[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-hidden="true"[\s\S]*<LoreText items=\{loadingQuotes\}/,
    "leaderboards loading state must be announced as a polite busy status with decorative spinner hidden",
  );
  assert.match(
    leaderboardsTooltipSource,
    /error &&[\s\S]*<UiPanel role="alert"[\s\S]*Retry/,
    "leaderboards error panel must be announced as an alert while preserving retry",
  );
  assert.match(
    leaderboardsTooltipSource,
    /safeToFixed\(e\.pct, 1, "0\.0"\)\}%/,
    "leaderboard lucky-tile percentage display must use the bounded shared formatter",
  );
  assert.doesNotMatch(
    leaderboardsTooltipSource,
    /e\.pct\.toFixed\(1\)/,
    "leaderboard lucky-tile percentage display must not call toFixed directly",
  );
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
