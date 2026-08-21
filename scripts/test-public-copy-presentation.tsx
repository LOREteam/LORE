import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FAQ } from "../app/components/FAQ";
import { getMobileRewardsWalletPresentation } from "../app/components/HubGameBoard";
import { Sidebar } from "../app/components/Sidebar";
import { WhitePaper } from "../app/components/WhitePaper";
import { CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS } from "../app/lib/constants";
import { shortenAddress } from "../app/lib/utils";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const whitePaper = renderToStaticMarkup(<WhitePaper />);
const faq = renderToStaticMarkup(<FAQ />);
const sidebar = renderToStaticMarkup(
  <Sidebar
    activeTab="hub"
    currentEpoch={1n}
    onTabChange={() => {}}
    hotTiles={[]}
    unclaimedWins={[{ epoch: "17", amountWei: "1000000000000000000" }]}
    isScanning={false}
    isDeepScanning={false}
    isClaiming
    onClaim={() => {}}
    onClaimAll={() => {}}
    mobileOpen
    onMobileClose={() => {}}
  />,
);

const disconnectedMobileRewards = getMobileRewardsWalletPresentation({
  walletAuthenticated: false,
  walletConnected: false,
  embeddedWalletSyncing: false,
});
assert.equal(disconnectedMobileRewards.walletCta, "login", "guest rewards must expose the login CTA");
assert.equal(disconnectedMobileRewards.message, "Log in to check rewards for your wallet", "mobile rewards must not claim an unchecked guest wallet has no rewards");

const walletCreationMobileRewards = getMobileRewardsWalletPresentation({
  walletAuthenticated: true,
  walletConnected: false,
  embeddedWalletSyncing: false,
});
assert.equal(walletCreationMobileRewards.walletCta, "create", "authenticated users without an embedded wallet must receive the create-wallet CTA");
assert.equal(walletCreationMobileRewards.message, "Create your LORE wallet to check rewards", "authenticated users without an embedded wallet must be told why rewards are unavailable");

const connectedMobileRewards = getMobileRewardsWalletPresentation({
  walletAuthenticated: true,
  walletConnected: true,
  embeddedWalletSyncing: false,
});
assert.equal(connectedMobileRewards.walletCta, "ready", "only a connected wallet may receive a completed reward result");
assert.equal(connectedMobileRewards.message, null, "the completed connected-wallet state must leave reward results to the scanner");
assert.doesNotMatch(whitePaper, /Claim Anytime/, "White Paper must not promise perpetual claims");
assert.doesNotMatch(
  whitePaper,
  /title="Cycles"[\s\S]{0,220}(?:1(?:\u2013|-)\u221e|infinite|unlimited)/i,
  "White Paper must not imply unlimited Auto-Miner cycles",
);
assert.match(whitePaper, /Total rounds to auto-bet \(1-5000\)/, "White Paper Auto-Miner cycle copy must match the runtime 5000-cycle cap");
assert.doesNotMatch(
  `${whitePaper}\n${faq}`,
  /(?:tested on|During) Sepolia\b/,
  "player-facing docs must name Linea Sepolia instead of generic Sepolia",
);
assert.match(faq, /<button[^>]*type="button"[^>]*aria-expanded="(?:true|false)"[^>]*aria-controls="[^"]+"/, "FAQ accordion buttons must remain non-submit controls with expanded/panel wiring");
assert.match(readFileSync("app/components/FAQ.tsx", "utf8"), /On mobile, open the Mining Hub's Unclaimed rewards card; on wider screens, use the Rewards panel in the sidebar/, "FAQ must direct mobile players to the visible rewards card rather than sidebar-only instructions");
assert.match(whitePaper, new RegExp(escapeRegExp(shortenAddress(CONTRACT_ADDRESS))), "White Paper must display the configured game contract instead of a stale literal address");
assert.match(whitePaper, new RegExp(escapeRegExp(shortenAddress(LINEA_TOKEN_ADDRESS))), "White Paper must display the configured LINEA token instead of a stale literal address");
assert.match(whitePaper, /<a[^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/, "White Paper must render a working Privacy Policy link");
assert.match(whitePaper, /<a[^>]*href="\/terms"[^>]*>Terms of Play<\/a>/, "White Paper must render a working Terms of Play link");
assert.match(sidebar, /<a[^>]*href="\/privacy"[^>]*class="[^"]*min-h-11[^"]*"[^>]*>Privacy<\/a>/, "Sidebar Privacy link must be rendered with a mobile touch target");
assert.match(sidebar, /<a[^>]*href="\/terms"[^>]*class="[^"]*min-h-11[^"]*"[^>]*>Terms<\/a>/, "Sidebar Terms link must be rendered with a mobile touch target");
assert.match(sidebar, /aria-label="Reward claim is already pending"[^>]*title="Reward claim is already pending"/, "Sidebar pending claim action must retain an accessible name and title");

const lineaOreClientSource = readFileSync("app/LineaOreClient.tsx", "utf8");
assert.match(lineaOreClientSource, /aria-expanded=\{mobileSidebarOpen\}/, "mobile sidebar opener must expose its expanded state");
assert.match(lineaOreClientSource, /aria-controls="lore-sidebar"/, "mobile sidebar opener must identify the controlled menu");

console.log("public-copy-presentation-pass");
