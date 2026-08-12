import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runPublicPresentationTests() {
  const layoutSource = readFileSync("app/layout.tsx", "utf8");
  const whitePaperSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  const termsPageSource = readFileSync("app/terms/page.tsx", "utf8");
  const roundBettingSource = readFileSync("app/hooks/useMiningRoundBetting.ts", "utf8");
  const faqSource = readFileSync("app/components/FAQ.tsx", "utf8");
  const leaderboardsComponentSource = readFileSync("app/components/Leaderboards.tsx", "utf8");
  const firstVisitTutorialSource = readFileSync("app/components/FirstVisitTutorial.tsx", "utf8");

  assert.match(
    readFileSync("app/hooks/useMiningStandardBetPath.ts", "utf8"),
    /EPOCH_BOUND_BITMAP_SELECTOR[\s\S]*getBytecode\(\{ address: CONTRACT_ADDRESS \}\)[\s\S]*bytecode\.toLowerCase\(\)\.includes/,
    "standard betting must detect the epoch-bound selector from deployed bytecode before choosing a V9 fallback",
  );
  assert.match(
    roundBettingSource,
    /placeBetsSilent\(tilesToBet, singleAmountRaw, overrides, txNonce, currentEpoch\)[\s\S]*placeBets\(tilesToBet, singleAmountRaw, overrides, txNonce, currentEpoch\)/,
    "auto-miner standard paths must bind each transaction to the planned epoch",
  );
  assert.match(whitePaperSource, /92% of fresh stake plus the full rollover/, "White Paper must explain that rollover is not charged fees again");
  assert.match(whitePaperSource, /0\.05% resolver reward[\s\S]*1\.95% is split approximately equally/, "White Paper must disclose the exact resolver-first protocol fee split");
  assert.doesNotMatch(whitePaperSource, /2% goes to protocol accounting: half to treasury and half to a Safety Pool/, "White Paper must not describe the protocol fee as an exact half split before the resolver reward");
  assert.doesNotMatch(whitePaperSource, /funds are only claimable by winners/, "White Paper must not hide Safety Pool, resolver, fee, or bounded dust-settlement paths");
  assert.match(whitePaperSource, /No arbitrary owner withdrawal[\s\S]*one-year dust-settlement paths/, "White Paper must describe the bounded V9 fund-movement paths accurately");
  assert.match(faqSource, /one year[\s\S]*timelocked fee-recipient address/, "FAQ must disclose the bounded unclaimed-funds settlement path");
  assert.match(faqSource, /on-chain entertainment game[\s\S]*not an investment product[\s\S]*comfortable risking/, "FAQ must include concise player-facing risk and terms copy without promising profit");
  assert.doesNotMatch(`${faqSource}\n${whitePaperSource}`, /Once per calendar (?:day|week)[\s\S]{0,140}triggers the (?:daily|weekly) jackpot/, "jackpot copy must not promise a fixed daily or weekly jackpot trigger");
  assert.match(termsPageSource, /on-chain entertainment game[\s\S]*not an investment product[\s\S]*comfortable risking/, "Terms of Play must frame game risk without profit promises");
  assert.match(termsPageSource, /one-year unclaimed[\s\S]*contract is the final source of truth/, "Terms of Play must describe contract-controlled unclaimed settlement paths");
  assert.match(termsPageSource, /Keep a backup[\s\S]*cannot restore a wallet[\s\S]*reverse a confirmed transaction/, "Terms of Play must warn about wallet responsibility without exposing internals");
  assert.match(`${readFileSync("app/privacy/page.tsx", "utf8")}\n${termsPageSource}`, /<svg aria-hidden="true"[\s\S]*Back to LORE[\s\S]*<svg aria-hidden="true"[\s\S]*Back to LORE/, "legal-page decorative back-link icons must be hidden from assistive tech");
  assert.match(`${readFileSync("app/privacy/page.tsx", "utf8")}\n${termsPageSource}`, /href="\/"[\s\S]*min-h-11[\s\S]*focus-visible:ring-2[\s\S]*Back to LORE[\s\S]*href="\/"[\s\S]*min-h-11[\s\S]*focus-visible:ring-2[\s\S]*Back to LORE/, "legal-page back links must keep mobile touch targets and visible focus rings");
  assert.doesNotMatch(
    `${layoutSource}\n${whitePaperSource}\n${termsPageSource}\n${leaderboardsComponentSource}\n${firstVisitTutorialSource}\n${readFileSync("app/opengraph-image.tsx", "utf8")}\n${readFileSync("app/components/analytics/analyticsAchievements.ts", "utf8")}`,
    /Mine, bet, and earn|return on investment|earn rewards|\bEarn\b|\bROI\b|Play consistently/,
    "public metadata, docs, and leaderboard copy must avoid investment-style promises",
  );
  assert.match(whitePaperSource, /explicit operator acceptance of this model[\s\S]*future hardening such as VRF or commit-reveal remains a separate protocol upgrade decision/, "White Paper must not imply VRF or commit-reveal is mandatory before mainnet launch");
  assert.doesNotMatch(`${readFileSync("app/opengraph-image.tsx", "utf8")}\n${readFileSync("app/api/jackpots/og/route.tsx", "utf8")}`, /letterSpacing:\s*["']-/, "OpenGraph images must not use negative letter spacing");
  const jackpotOgRouteSource = readFileSync("app/api/jackpots/og/route.tsx", "utf8");
  assert.match(jackpotOgRouteSource, /import \{ parseBoundedPositiveIntegerParam \} from "\.\.\/\.\.\/_lib\/queryParams";[\s\S]*function sanitizePositiveInt\(raw: string \| null, max: number\)[\s\S]*parseBoundedPositiveIntegerParam\(raw, max\)/, "jackpot OpenGraph chips must reuse strict bounded integer query parsing for tile and epoch");
  assert.doesNotMatch(jackpotOgRouteSource, /CANONICAL_POSITIVE_INTEGER_RE|const parsed = Number\(value\)|raw\?\.trim\(\)[\s\S]*Number\(|\^\[0-9\]\{1,10\}\$|Number\.isInteger\(parsed\)/, "jackpot OpenGraph integer parsing must not reintroduce local Number() coercion or trim-normalized integer parsing");
  assert.doesNotMatch(faqSource, /hardened V9 source/, "FAQ must not describe the active V10 release as the old hardened V9 source");
  assert.doesNotMatch(`${faqSource}\n${whitePaperSource}`, /V9-compatible|ReentrancyGuard/, "player-facing FAQ and White Paper must avoid stale internal V9/library naming");
  assert.doesNotMatch(`${faqSource}\n${whitePaperSource}`, /Phylax|90% cheaper|extremely low|proof aggregation/i, "player-facing FAQ and White Paper must avoid unverified security or gas-cost promises");
}
