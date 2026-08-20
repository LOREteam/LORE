import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RewardScanner } from "../app/components/RewardScanner";

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

console.log("reward-scanner-presentation-pass");
