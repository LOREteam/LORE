import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as rewardScannerModule from "../app/hooks/useRewardScanner.ts";

export function runRewardScannerTests() {
  const rewardScanner = rewardScannerModule.default ?? rewardScannerModule;
  const rewardScanNow = 1_000_000;
  assert.equal(rewardScanner.normalizeRewardScanEpochString("42"), "42");
  assert.equal(rewardScanner.normalizeRewardScanEpochString("bad"), null);
  assert.deepEqual(
    rewardScanner.normalizeRewardScanWins([
      { epoch: "12", amountWei: "1000" },
      { epoch: "bad", amountWei: "1000" },
      { epoch: "13", amountWei: "bad" },
    ]),
    [{ epoch: "12", amountWei: "1000" }],
  );
  assert.deepEqual(
    [
      { epoch: "10", amountWei: "1" },
      { epoch: "bad", amountWei: "1" },
      { epoch: "2", amountWei: "1" },
    ].sort(rewardScanner.compareRewardScanWinsDesc),
    [
      { epoch: "10", amountWei: "1" },
      { epoch: "2", amountWei: "1" },
      { epoch: "bad", amountWei: "1" },
    ],
  );
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(null, rewardScanNow), 0);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow - 14 * 60_000, rewardScanNow), 60_000);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow - 15 * 60_000, rewardScanNow), 0);
  assert.equal(rewardScanner.getRewardScanRescanDelayMs(rewardScanNow + 1, rewardScanNow), 0);
  const claimWindow = 365n * 24n * 60n * 60n;
  assert.equal(rewardScanner.isRewardClaimWindowOpen(0n, claimWindow * 2n), true);
  assert.equal(rewardScanner.isRewardClaimWindowOpen(10n, 10n + claimWindow - 1n), true);
  assert.equal(rewardScanner.isRewardClaimWindowOpen(10n, 10n + claimWindow), false);
  assert.equal(rewardScanner.formatRewardClaimError(new Error("RewardClaimWindowExpired()")), "This reward claim window has expired.");
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("Transaction receipt timeout")),
    "Reward claim status is unknown after a wallet timeout. Check wallet activity before retrying.",
  );
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("execution reverted")),
    "Reward claim reverted on-chain. No reward was moved by this transaction.",
  );
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("insufficient funds for gas")),
    "Reward claim failed: not enough balance or ETH for gas.",
  );
  assert.equal(
    rewardScanner.formatRewardClaimError(new Error("JSON-RPC provider unavailable")),
    "Reward claim hit a wallet or RPC issue. Check wallet activity before retrying.",
  );

  const rewardScannerSource = readFileSync("app/hooks/useRewardScanner.ts", "utf8");
  const rewardScannerComponentSource = readFileSync("app/components/RewardScanner.tsx", "utf8");
  assert.match(rewardScannerSource, /MAX_SCAN_DEPTH\s*=\s*BigInt\(5000\)/, "automatic reward scan depth must remain at 5000 epochs");
  assert.doesNotMatch(
    rewardScannerSource,
    /MAX_CONSECUTIVE_EMPTY|consecutiveEmpty\s*>?=/,
    "automatic reward scans must not silently truncate the configured 5000-epoch search after empty chunks",
  );
  assert.match(rewardScannerSource, /getExplorerTxUrl/, "single reward claim notifications must include explorer links when a tx hash is available");
  assert.match(
    rewardScannerSource,
    /const waitReceipt = useCallback[\s\S]*waitForTransactionReceipt\(\{ hash \}\)[\s\S]*if \(receipt\.status !== "success"\) \{[\s\S]*throw new Error\(`Transaction reverted: \$\{hash\}`\);[\s\S]*getTransactionReceipt\(\{ hash \}\)[\s\S]*if \(lateReceipt\.status !== "success"\) \{[\s\S]*throw new Error\(`Transaction reverted: \$\{hash\}`\);/,
    "reward claim receipt helper must reject primary and late reverted receipts",
  );
  assert.doesNotMatch(rewardScannerSource, /Preparing reward claims? from the Privy wallet/, "reward claim preparation toasts must stay short and avoid redundant Privy-wallet wording");
  assert.match(
    rewardScannerSource,
    /preferredAddress[\s\S]*const \{ address: connectedAddress \} = useAccount\(\)[\s\S]*getAddress\(candidate\)/,
    "reward scanning and claiming must prefer the canonical embedded wallet actor over the connected wallet",
  );
  assert.match(
    rewardScannerSource,
    /for \(let offset = 0; offset < cached\.wins\.length; offset \+= REWARD_SCAN_CHUNK_SIZE_NUMBER\)[\s\S]*cachedWinChunk = cached\.wins\.slice\(offset, offset \+ REWARD_SCAN_CHUNK_SIZE_NUMBER\)[\s\S]*scanAbortRef\.current/,
    "reward scanner must revalidate cached wins in bounded abort-aware chunks",
  );
  const lineaOreHubRuntimeSource = readFileSync("app/hooks/useLineaOreHubRuntime.ts", "utf8");
  assert.match(
    lineaOreHubRuntimeSource,
    /useRewardScanner[\s\S]*enabled: activeTab === "hub" && Boolean\(embeddedWalletAddress\)[\s\S]*preferredAddress: embeddedWalletAddress[\s\S]*sendTransactionSilent: miningSendTransactionSilent/,
    "hub rewards must scan the same embedded wallet that submits claims",
  );
  assert.match(rewardScannerSource, /functionName:\s*"epochResolvedAt"[\s\S]*isRewardClaimWindowOpen/, "automatic reward scans must remove expired candidates without adding reads for every scanned epoch");
  const deepRewardScannerSource = readFileSync("app/hooks/useDeepRewardScan.ts", "utf8");
  assert.match(deepRewardScannerSource, /functionName:\s*"epochResolvedAt"[\s\S]*isRewardClaimWindowOpen/, "deep reward scans must apply the same on-chain claim deadline");
  assert.match(rewardScannerSource, /lastRewardClaimTxHash/, "batch reward claim notifications must keep the latest tx hash for explorer links");
  assert.match(
    rewardScannerComponentSource,
    /aria-label=\{claimAllLabel\}[\s\S]*title=\{claimAllLabel\}[\s\S]*aria-label=\{scanLabel\}[\s\S]*title=\{scanLabel\}[\s\S]*aria-label=\{claimOneLabel\}[\s\S]*title=\{claimOneLabel\}/,
    "reward scan and claim controls must expose accessible labels and disabled-state titles",
  );
  assert.match(rewardScannerComponentSource, /type="button"[\s\S]*aria-label=\{claimAllLabel\}[\s\S]*type="button"[\s\S]*aria-label=\{scanLabel\}[\s\S]*type="button"[\s\S]*aria-label=\{claimOneLabel\}/, "reward scan and claim controls must remain non-submit buttons");
  assert.match(rewardScannerComponentSource, /role="status"[\s\S]*aria-live="polite"[\s\S]*Full reward history is still loading in background/, "deep reward scan progress must be announced without changing recovery scan behavior");
  assert.match(rewardScannerComponentSource, /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-hidden="true"[\s\S]*<LoreText items=\{searchingQuotes\}/, "reward scan empty-results loading must be announced as a polite busy status with decorative spinner hidden");
  assert.match(
    rewardScannerSource,
    /const claimInFlightRef = useRef\(false\)[\s\S]*const claimReward[\s\S]*if \(claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;[\s\S]*const claimAll[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;/,
    "reward claims must synchronously prevent overlapping single and batch submissions",
  );
  assert.match(rewardScannerSource, /activeClaimAddressRef\.current = address\?\.toLowerCase\(\)[\s\S]*const claimActor = address\.toLowerCase\(\)[\s\S]*activeClaimAddressRef\.current !== claimActor[\s\S]*claimActorChanged/, "reward claims must stop sends and stale state updates when the active wallet changes");

  const deepRewardScanSource = readFileSync("app/hooks/useDeepRewardScan.ts", "utf8");
  assert.match(deepRewardScanSource, /getExplorerTxUrl/, "deep reward claim notifications must include explorer links when a tx hash is available");
  assert.match(deepRewardScanSource, /readJsonResponse<ClaimCandidatePage>/, "deep reward candidate scans must use the bounded JSON response helper");
  assert.match(deepRewardScanSource, /import \{ fetchWithTimeout \} from "\.\.\/lib\/fetchWithTimeout";[\s\S]*fetchWithTimeout\(`\/api\/claim-candidates\?\$\{query\.toString\(\)\}`,\s*\{ cache: "no-store" \}\)/, "deep reward candidate scans must use the shared fetch timeout helper");
  assert.doesNotMatch(deepRewardScanSource, /response\.json\(\)/, "deep reward candidate scans must not use unbounded response.json");
  assert.match(deepRewardScanSource, /const claimInFlightRef = useRef\(false\)[\s\S]*claimOne[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;[\s\S]*claimAllDeep[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;/, "deep reward claims must share a synchronous submission lock");
  assert.match(deepRewardScanSource, /claimOne[\s\S]*isAmbiguousPendingTxError\(err\)[\s\S]*!isUserRejection\(err\)[\s\S]*Reward claim rejected in wallet\./, "deep single reward claim must surface wallet rejection instead of silently clearing the claim state");
  assert.match(deepRewardScanSource, /claimOne[\s\S]*const hash = await sendTransactionSilent\(\{ to: CONTRACT_ADDRESS, data, gas \}\);[\s\S]*try \{[\s\S]*receiptState = await waitReceipt\(hash\);[\s\S]*isDefinitiveClaimRevertError\(err\)[\s\S]*markPostSendClaimVerificationError\(err, hash\)[\s\S]*const postSendHash = getPostSendClaimVerificationHash\(err\);[\s\S]*Claim transaction submitted and is still pending\. Rewards will refresh after confirmation\.[\s\S]*formatRewardClaimError\(err\)/, "deep single reward claim must treat unknown post-send receipt verification as pending before generic errors");
  assert.match(deepRewardScanSource, /let claimRejected = false[\s\S]*if \(isUserRejection\(err\)\) \{[\s\S]*claimRejected = true[\s\S]*if \(claimRejected && claimedEpochs\.size === 0 && !pendingClaimTx\)[\s\S]*Reward claim rejected in wallet\./, "deep batch reward claim must surface wallet rejection when no prior claim transaction succeeded or remains pending");
  assert.match(deepRewardScanSource, /function isDefinitiveClaimRevertError\(error: unknown\)[\s\S]*startsWith\("transaction reverted:"\)[\s\S]*function markPostSendClaimVerificationError\(error: unknown, hash: `0x\$\{string\}`\)[\s\S]*claimTxSubmitted = true[\s\S]*function getPostSendClaimVerificationHash\(error: unknown\)[\s\S]*claimTxSubmitted === true/, "deep reward post-send receipt verification errors must carry tx hashes unless the receipt is a definitive revert");
  assert.match(deepRewardScanSource, /const hash = await sendTransactionSilent\(\{ to: CONTRACT_ADDRESS, data, gas \}\);[\s\S]*try \{[\s\S]*receiptState = await waitReceipt\(hash\);[\s\S]*isDefinitiveClaimRevertError\(err\)[\s\S]*markPostSendClaimVerificationError\(err, hash\)[\s\S]*const postSendHash = getPostSendClaimVerificationHash\(err\);[\s\S]*pendingClaimTx = true;[\s\S]*break;/, "deep reward claim-all must stop further sends after an unknown post-send receipt verification state");
  assert.match(deepRewardScanSource, /activeClaimAddressRef\.current = address\?\.toLowerCase\(\) \?\? null[\s\S]*const claimActor = address\.toLowerCase\(\)[\s\S]*activeClaimAddressRef\.current !== claimActor[\s\S]*claimActorChanged/, "deep reward claims must stop batches and stale state updates when the active wallet changes");
}
