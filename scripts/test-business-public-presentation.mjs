import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as faqModule from "../app/components/FAQ.tsx";
import * as whitePaperModule from "../app/components/WhitePaper.tsx";
import * as termsPageModule from "../app/terms/page.tsx";
import * as privacyPageModule from "../app/privacy/page.tsx";

const faq = faqModule.default ?? faqModule;
const whitePaper = whitePaperModule.default ?? whitePaperModule;
const termsPage = termsPageModule.default ?? termsPageModule;
const privacyPage = privacyPageModule.default ?? privacyPageModule;
const FAQ = faq.FAQ;
const getFaqPresentationModel = faq.getFaqPresentationModel;
const WhitePaper = whitePaper.WhitePaper;
const TermsPage = termsPage.default;
const PrivacyPage = privacyPage.default;

function presentationText(markup) {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

function assertResponsiblePlayerCopy(text) {
  assert.doesNotMatch(
    text,
    /Mine, bet, and earn|return on investment|earn rewards|\bEarn\b|\bROI\b|Play consistently|Phylax|90% cheaper|extremely low|proof aggregation/i,
  );
}

function renderFaqCategory(category, openIndex = 0) {
  return renderToStaticMarkup(React.createElement(FAQ, {
    initialCategory: category,
    initialOpenIndex: openIndex,
  }));
}

export function runPublicPresentationTests() {
  const layoutSource = readFileSync("app/layout.tsx", "utf8");
  const whitePaperMarkup = renderToStaticMarkup(React.createElement(WhitePaper));
  const whitePaperText = presentationText(whitePaperMarkup);
  const termsPageMarkup = renderToStaticMarkup(React.createElement(TermsPage));
  const termsPageText = presentationText(termsPageMarkup);
  const privacyPageMarkup = renderToStaticMarkup(React.createElement(PrivacyPage));
  const roundBettingSource = readFileSync("app/hooks/useMiningRoundBetting.ts", "utf8");
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
  assert.match(whitePaperText, /92% of fresh stake plus the full rollover/, "White Paper must explain that rollover is not charged fees again");
  assert.match(whitePaperText, /0\.05% resolver reward[\s\S]*1\.95% is split approximately equally/, "White Paper must disclose the exact resolver-first protocol fee split");
  assert.doesNotMatch(whitePaperText, /2% goes to protocol accounting: half to treasury and half to a Safety Pool/, "White Paper must not describe the protocol fee as an exact half split before the resolver reward");
  assert.doesNotMatch(whitePaperText, /funds are only claimable by winners/, "White Paper must not hide Safety Pool, resolver, fee, or bounded dust-settlement paths");
  assert.match(whitePaperText, /No arbitrary owner withdrawal[\s\S]*one-year dust-settlement paths/, "White Paper must describe the bounded V9 fund-movement paths accurately");

  const walletFaqModel = getFaqPresentationModel("Wallet & Security", 0);
  const walletFaqText = walletFaqModel.items.flatMap((item) => [item.q, ...[item.a].flat()]).join(" ");
  const strategyFaqText = presentationText(renderFaqCategory("Betting & Strategy"));
  const jackpotFaqText = presentationText(renderFaqCategory("Jackpots"));
  assert.match(walletFaqText, /one year[\s\S]*timelocked fee-recipient address/, "FAQ must disclose the bounded unclaimed-funds settlement path");
  assert.match(strategyFaqText, /on-chain entertainment game[\s\S]*not an investment product[\s\S]*comfortable risking/, "FAQ must include concise player-facing risk and terms copy without promising profit");
  assert.doesNotMatch(`${jackpotFaqText}\n${whitePaperText}`, /Once per calendar (?:day|week)[\s\S]{0,140}triggers the (?:daily|weekly) jackpot/, "jackpot copy must not promise a fixed daily or weekly jackpot trigger");
  assert.match(termsPageText, /on-chain entertainment game[\s\S]*not an investment product[\s\S]*comfortable risking/, "Terms of Play must frame game risk without profit promises");
  assert.match(termsPageText, /one-year unclaimed[\s\S]*contract is the final source of truth/, "Terms of Play must describe contract-controlled unclaimed settlement paths");
  assert.match(termsPageText, /Keep a backup[\s\S]*cannot restore a wallet[\s\S]*reverse a confirmed transaction/, "Terms of Play must warn about wallet responsibility without exposing internals");
  for (const legalMarkup of [privacyPageMarkup, termsPageMarkup]) {
    const backLink = legalMarkup.match(/<a\b[^>]*href="\/"[^>]*>[\s\S]*?Back to LORE[\s\S]*?<\/a>/)?.[0];
    assert.ok(backLink, "legal page must render its home link");
    assert.match(backLink, /<svg\b[^>]*aria-hidden="true"/, "legal-page decorative back-link icon must be hidden from assistive tech");
    assert.match(backLink, /\bmin-h-11\b/, "legal-page back link must keep its mobile touch target");
    assert.match(backLink, /\bfocus-visible:ring-2\b/, "legal-page back link must keep a visible focus ring");
  }
  assert.doesNotMatch(
    `${layoutSource}\n${leaderboardsComponentSource}\n${firstVisitTutorialSource}\n${readFileSync("app/opengraph-image.tsx", "utf8")}\n${readFileSync("app/components/analytics/analyticsAchievements.ts", "utf8")}`,
    /Mine, bet, and earn|return on investment|earn rewards|\bEarn\b|\bROI\b|Play consistently/,
    "public metadata, docs, and leaderboard copy must avoid investment-style promises",
  );
  assertResponsiblePlayerCopy(`${whitePaperText} ${termsPageText} ${walletFaqText} ${strategyFaqText} ${jackpotFaqText}`);
  assert.throws(
    () => assertResponsiblePlayerCopy("Play consistently for 90% cheaper ROI and earn rewards"),
    { name: "AssertionError" },
    "investment-promise mutant must be rejected",
  );
  assert.match(whitePaperText, /explicit operator acceptance of this model[\s\S]*future hardening such as VRF or commit-reveal remains a separate protocol upgrade decision/, "White Paper must not imply VRF or commit-reveal is mandatory before mainnet launch");
  assert.doesNotMatch(`${readFileSync("app/opengraph-image.tsx", "utf8")}\n${readFileSync("app/api/jackpots/og/route.tsx", "utf8")}`, /letterSpacing:\s*["']-/, "OpenGraph images must not use negative letter spacing");
  const jackpotOgRouteSource = readFileSync("app/api/jackpots/og/route.tsx", "utf8");
  assert.match(jackpotOgRouteSource, /readVerifiedJackpotShare\(\s*request\.nextUrl\.searchParams\.get\("event"\)\s*\?\?\s*request\.nextUrl\.searchParams\.get\("tx"\),\s*\)/, "jackpot OpenGraph image must resolve a canonical event id before the legacy transaction fallback");
  assert.match(jackpotOgRouteSource, /const \{ amount, epoch \} = share;[\s\S]*getJackpotVisualTheme\(share\.kind\)/, "jackpot OpenGraph image must derive its fields from the verified jackpot event");
  assert.doesNotMatch(jackpotOgRouteSource, /searchParams\.get\("(?:amount|tile|epoch|kind)"\)|parseBoundedPositiveIntegerParam|sanitizePositiveInt/, "jackpot OpenGraph image must not render amount, tile, epoch, or mode from URL parameters");
  const allFaqText = getFaqPresentationModel().categories
    .flatMap((category) => getFaqPresentationModel(category).items)
    .flatMap((item) => [item.q, ...[item.a].flat()])
    .join(" ");
  assert.doesNotMatch(allFaqText, /hardened V9 source/, "FAQ must not describe the active V10 release as the old hardened V9 source");
  assert.doesNotMatch(`${allFaqText}\n${whitePaperText}`, /V9-compatible|ReentrancyGuard/, "player-facing FAQ and White Paper must avoid stale internal V9/library naming");
  assertResponsiblePlayerCopy(`${allFaqText}\n${whitePaperText}`);

  const invalidFaqModel = getFaqPresentationModel("unknown-category", Number.NaN);
  assert.equal(invalidFaqModel.activeCategory, "Getting Started");
  assert.equal(invalidFaqModel.openIndex, null);
  const jackpotOpenMarkup = renderFaqCategory("Jackpots", 0);
  assert.match(jackpotOpenMarkup, /aria-expanded="true"[^>]*aria-controls="faq-panel-Jackpots-0"/);
  assert.match(jackpotOpenMarkup, /id="faq-panel-Jackpots-0" role="region" aria-hidden="false"/);
  const jackpotClosedMarkup = renderFaqCategory("Jackpots", -1);
  assert.match(jackpotClosedMarkup, /aria-expanded="false"[^>]*aria-controls="faq-panel-Jackpots-0"/);
  assert.match(jackpotClosedMarkup, /id="faq-panel-Jackpots-0" role="region" aria-hidden="true"/);
}
