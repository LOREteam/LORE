import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FAQ } from "../app/components/FAQ";
import { getMobileRewardsWalletPresentation } from "../app/components/HubGameBoard";
import { createWalletSetupGuard } from "../app/lib/walletSetup";
import { Sidebar } from "../app/components/Sidebar";
import { WhitePaper } from "../app/components/WhitePaper";
import { CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS } from "../app/lib/constants";
import { shortenAddress } from "../app/lib/utils";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type SidebarProps = React.ComponentProps<typeof Sidebar>;

function renderSidebar(options: Partial<SidebarProps> = {}) {
  return renderToStaticMarkup(
    <Sidebar
      activeTab="hub"
      currentEpoch={1n}
      onTabChange={() => {}}
      hotTiles={[]}
      unclaimedWins={[]}
      rewardScanState={{
        status: "verified",
        walletAddress: "0xabc",
        lastVerifiedAt: 1_000,
        incomplete: false,
        error: null,
      }}
      rewardsWalletCta="ready"
      isScanning={false}
      isDeepScanning={false}
      isClaiming={false}
      onClaim={() => {}}
      onClaimAll={() => {}}
      onCreateWallet={async () => {}}
      walletSetupError={null}
      onScan={() => {}}
      {...options}
    />,
  );
}
const whitePaper = renderToStaticMarkup(<WhitePaper />);
const faq = renderToStaticMarkup(<FAQ />);
const sidebar = renderSidebar({
  unclaimedWins: [{ epoch: "17", amountWei: "1000000000000000000" }],
  isClaiming: true,
  mobileOpen: true,
  onMobileClose: () => {},
});
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
assert.match(sidebar, /Rewards verified\. Last verified/, "verified visible rewards must expose their verification watermark");

const verifiedEmptySidebar = renderSidebar();
assert.match(verifiedEmptySidebar, /No claimable rewards/, "only a complete verified scan may report an empty rewards result");
assert.doesNotMatch(verifiedEmptySidebar, /Retry reward scan/, "a current verified empty result should not imply a retry is necessary");

const idleSidebar = renderSidebar({ rewardScanState: { status: "idle", walletAddress: "0xabc", lastVerifiedAt: null, incomplete: false, error: null } });
assert.match(idleSidebar, /Rewards have not been checked yet\./, "idle rewards must not use the empty-result copy");
assert.match(idleSidebar, /aria-label="Retry reward scan"/, "idle rewards must expose a scan action");

const loadingSidebar = renderSidebar({ isScanning: true, rewardScanState: { status: "loading", walletAddress: "0xabc", lastVerifiedAt: null, incomplete: false, error: null } });
assert.match(loadingSidebar, /Checking reward history\./, "loading rewards must remain explicit");
assert.match(loadingSidebar, /<button[^>]*aria-label="Reward scan is already running"[^>]*>/, "loading rewards must keep the scan action visible");
assert.doesNotMatch(loadingSidebar, /No claimable rewards/, "loading rewards must not use empty-result copy");

const staleSidebar = renderSidebar({ unclaimedWins: [{ epoch: "101", amountWei: "1000000000000000000" }], rewardScanState: { status: "stale", walletAddress: "0xabc", lastVerifiedAt: 1_000, incomplete: false, error: null } });
assert.match(staleSidebar, /Showing last verified rewards\./, "stale rewards must retain their provenance");
assert.match(staleSidebar, /#101/, "stale rewards must retain visible prior wins");
assert.match(staleSidebar, /aria-label="Retry reward scan"/, "stale rewards must expose refresh");

const errorSidebar = renderSidebar({ rewardScanState: { status: "error", walletAddress: "0xabc", lastVerifiedAt: null, incomplete: false, error: "RPC unavailable" } });
assert.match(errorSidebar, /Reward scan failed\./, "failed rewards scan must not use empty-result copy");
assert.match(errorSidebar, /aria-label="Retry reward scan"/, "failed rewards scan must expose retry");

const partialSidebar = renderSidebar({ rewardScanState: { status: "stale", walletAddress: "0xabc", lastVerifiedAt: 1_000, incomplete: true, error: "short multicall" } });
assert.match(partialSidebar, /Reward scan was incomplete\. Results may be partial\./, "partial rewards data must remain explicit");
assert.match(partialSidebar, /aria-label="Retry reward scan"/, "partial rewards data must expose retry");
assert.doesNotMatch(partialSidebar, /No claimable rewards/, "partial rewards data must not use empty-result copy");
const guestRewardsSidebar = renderSidebar({
  rewardsWalletCta: "login",
  unclaimedWins: [{ epoch: "101", amountWei: "100" }],
  rewardScanState: { status: "error", walletAddress: null, lastVerifiedAt: null, incomplete: false, error: "RPC unavailable" },
});
assert.match(guestRewardsSidebar, /Log in to check rewards for your wallet\./, "guest rewards must explain the required login");
assert.match(guestRewardsSidebar, /aria-label="Log in to check rewards"/, "guest rewards must expose a real login action");
assert.doesNotMatch(guestRewardsSidebar, /Retry reward scan/, "guest rewards must not expose a silent scanner retry");
assert.doesNotMatch(guestRewardsSidebar, /Claim all/, "guest rewards must not expose stale claim actions");

const createWalletRewardsSidebar = renderSidebar({ rewardsWalletCta: "create" });
assert.match(createWalletRewardsSidebar, /Create your LORE wallet to check rewards\./, "authenticated users without a wallet must get the create-wallet explanation");
assert.match(createWalletRewardsSidebar, /aria-label="Create LORE wallet to check rewards"/, "create-wallet rewards CTA must be actionable");
assert.doesNotMatch(createWalletRewardsSidebar, /Retry reward scan/, "create-wallet state must not expose scanner retry");

const creatingRewardsSidebar = renderSidebar({ rewardsWalletCta: "creating" });
assert.match(creatingRewardsSidebar, /Creating your LORE wallet\./, "shared wallet setup must show creation in progress");
assert.doesNotMatch(creatingRewardsSidebar, /aria-label="Create LORE wallet to check rewards"/, "creating wallet state must prevent a parallel create action");

const failedWalletSetupSidebar = renderSidebar({
  rewardsWalletCta: "create",
  walletSetupError: "Wallet creation could not be completed. Please try again.",
});
assert.match(failedWalletSetupSidebar, /Wallet creation could not be completed\. Please try again\./, "failed wallet setup must show a retryable error");
assert.match(failedWalletSetupSidebar, /aria-label="Create LORE wallet to check rewards"/, "failed wallet setup must retain the retry action");

void (async () => {
  const walletSetupStates: string[] = [];
  let walletSetupCalls = 0;
  const firstWalletSetupDeferred: { reject: ((reason?: unknown) => void) | null } = { reject: null };
  const sharedWalletSetupGuard = createWalletSetupGuard({
    onCreateEmbeddedWallet: () => {
      walletSetupCalls += 1;
      if (walletSetupCalls > 1) return Promise.resolve();
      return new Promise<void>((_resolve, reject) => {
        firstWalletSetupDeferred.reject = reject;
      });
    },
    onStateChange: (state) => walletSetupStates.push(state),
  });
  const firstWalletSetup = sharedWalletSetupGuard.run();
  const duplicateWalletSetup = sharedWalletSetupGuard.run();
  assert.equal(walletSetupCalls, 1, "shared wallet setup guard must not start a parallel create request");
  if (!firstWalletSetupDeferred.reject) throw new Error("wallet setup deferred rejection was not initialized");
  firstWalletSetupDeferred.reject(new Error("rejected"));
  await Promise.all([firstWalletSetup, duplicateWalletSetup]);
  assert.deepEqual(walletSetupStates, ["creating", "error"], "wallet setup rejection must become visible retryable state");
  await sharedWalletSetupGuard.run();
  assert.equal(walletSetupCalls, 2, "wallet setup error must permit a later retry");
  sharedWalletSetupGuard.reset();
  assert.equal(walletSetupStates.at(-1), "idle", "wallet connection reset must release the shared setup lock");
})().catch((error: unknown) => {
  throw error;
});
const syncingRewardsSidebar = renderSidebar({ rewardsWalletCta: "syncing" });
assert.match(syncingRewardsSidebar, /Your LORE wallet is still loading\./, "syncing wallet must remain a non-action status");
assert.doesNotMatch(syncingRewardsSidebar, /aria-label="Log in to check rewards"/, "syncing wallet must not show a login action");
assert.doesNotMatch(syncingRewardsSidebar, /aria-label="Create LORE wallet to check rewards"/, "syncing wallet must not show a create action");
assert.doesNotMatch(syncingRewardsSidebar, /Retry reward scan/, "syncing wallet must not expose scanner retry");
const lineaOreClientSource = readFileSync("app/LineaOreClient.tsx", "utf8");
assert.match(lineaOreClientSource, /aria-expanded=\{mobileSidebarOpen\}/, "mobile sidebar opener must expose its expanded state");
assert.match(lineaOreClientSource, /aria-controls="lore-sidebar"/, "mobile sidebar opener must identify the controlled menu");

console.log("public-copy-presentation-pass");
