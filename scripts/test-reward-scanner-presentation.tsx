import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RewardScanner } from "../app/components/RewardScanner";
import { getMobileRewardScanPresentation, getMobileRewardsWalletPresentation } from "../app/components/HubGameBoard";

type RewardScannerProps = React.ComponentProps<typeof RewardScanner>;

const rewardScannerNoop = () => {};

function renderRewardScanner(options: Partial<RewardScannerProps> = {}) {
  return renderToStaticMarkup(
    <RewardScanner
      unclaimedWins={[]}
      isScanning={false}
      isDeepScanning={false}
      isClaiming={false}
      onScan={rewardScannerNoop}
      onClaim={rewardScannerNoop}
      onClaimAll={rewardScannerNoop}
      {...options}
    />,
  );
}

const rewards = [
  { epoch: "101", amountWei: "1000000000000000000" },
  { epoch: "100", amountWei: "2000000000000000000" },
];
const ready = renderRewardScanner({ unclaimedWins: rewards });
assert.match(ready, /<button type="button" aria-label="Claim all 2 rewards" title="Claim all 2 rewards"/);
assert.match(ready, /<button type="button" aria-label="Scan for unclaimed rewards" title="Scan for unclaimed rewards"/);
assert.match(ready, /<button type="button" aria-label="Claim this reward" title="Claim this reward"/);

const claiming = renderRewardScanner({ unclaimedWins: rewards, isClaiming: true });
assert.match(claiming, /aria-label="Reward claim is already pending" title="Reward claim is already pending"[^>]*disabled=""/);

const deep = renderRewardScanner({ isDeepScanning: true });
assert.match(deep, /<div role="status" aria-live="polite"[^>]*>.*Full reward history is still loading in background\./);

const scanning = renderRewardScanner({ isScanning: true });
assert.match(scanning, /<div role="status" aria-live="polite" aria-busy="true"[^>]*>.*<svg aria-hidden="true"/);

const verifiedEmptyMobileRewards = getMobileRewardScanPresentation({
  rewardScanState: { status: "verified", walletAddress: "0xabc", lastVerifiedAt: 1_000, incomplete: false, error: null },
  isScanning: false,
  isDeepScanning: false,
  hasVisibleWins: false,
});
assert.deepEqual(verifiedEmptyMobileRewards, { message: "No claimable rewards found", canRetry: false, scanInProgress: false });

const idleMobileRewards = getMobileRewardScanPresentation({
  rewardScanState: { status: "idle", walletAddress: "0xabc", lastVerifiedAt: null, incomplete: false, error: null },
  isScanning: false,
  isDeepScanning: false,
  hasVisibleWins: false,
});
assert.equal(idleMobileRewards.message, "Rewards have not been checked yet.");
assert.equal(idleMobileRewards.canRetry, true);

const loadingMobileRewards = getMobileRewardScanPresentation({
  rewardScanState: { status: "loading", walletAddress: "0xabc", lastVerifiedAt: null, incomplete: false, error: null },
  isScanning: true,
  isDeepScanning: false,
  hasVisibleWins: false,
});
assert.equal(loadingMobileRewards.message, "Checking on-chain rewards…");
assert.equal(loadingMobileRewards.scanInProgress, true);

const staleMobileRewards = getMobileRewardScanPresentation({
  rewardScanState: { status: "stale", walletAddress: "0xabc", lastVerifiedAt: 1_000, incomplete: false, error: null },
  isScanning: false,
  isDeepScanning: false,
  hasVisibleWins: true,
});
assert.equal(staleMobileRewards.message, "Showing last verified rewards.");
assert.equal(staleMobileRewards.canRetry, true);

const failedMobileRewards = getMobileRewardScanPresentation({
  rewardScanState: { status: "error", walletAddress: "0xabc", lastVerifiedAt: null, incomplete: false, error: "RPC unavailable" },
  isScanning: false,
  isDeepScanning: false,
  hasVisibleWins: false,
});
assert.equal(failedMobileRewards.message, "Reward scan failed.");
assert.equal(failedMobileRewards.canRetry, true);

const partialMobileRewards = getMobileRewardScanPresentation({
  rewardScanState: { status: "stale", walletAddress: "0xabc", lastVerifiedAt: 1_000, incomplete: true, error: "short multicall" },
  isScanning: false,
  isDeepScanning: false,
  hasVisibleWins: true,
});
assert.equal(partialMobileRewards.message, "Reward scan was incomplete. Results may be partial.");
assert.equal(partialMobileRewards.canRetry, true);

assert.equal(getMobileRewardsWalletPresentation({ walletAuthenticated: false, walletConnected: false, embeddedWalletSyncing: false }).walletCta, "login");
assert.equal(getMobileRewardsWalletPresentation({ walletAuthenticated: true, walletConnected: false, embeddedWalletSyncing: false }).walletCta, "create");
console.log("reward-scanner-presentation-pass");
