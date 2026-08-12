import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runWinsPresentationTests() {
  const recentWinsApiSource = readFileSync("app/api/recent-wins/data.ts", "utf8");
  const winsTickerSource = readFileSync("app/components/WinsTicker.tsx", "utf8");
  assert.match(
    winsTickerSource,
    /const userLabel = shortenAddr\(w\.user\)[\s\S]*title=\{`Epoch #\$\{w\.epoch\}, \+\$\{w\.amount\} LINEA, \$\{userLabel\}`\}/,
    "wins ticker tooltip must use the same shortened user label as the visible feed chip",
  );
  assert.match(
    winsTickerSource,
    /function divideDecimalTextFixed\(value: string, divisor: number, fractionDigits: number\)[\s\S]*BigInt\(`\$\{whole\}\$\{fractionalRaw\}`[\s\S]*formatScaledUnitsFixed\(scaledOutput, fractionDigits\)[\s\S]*formatDecimalTextFixed\(normalized, 2\)/,
    "wins ticker compact reward display must use decimal-text and bigint scaling",
  );
  assert.doesNotMatch(
    winsTickerSource,
    /Number\.parseFloat|\.toFixed\(/,
    "wins ticker compact reward display must not use parseFloat().toFixed()",
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
