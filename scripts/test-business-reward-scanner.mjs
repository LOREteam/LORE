import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RewardScanner } from "../app/components/RewardScanner.tsx";
import * as rewardScannerModule from "../app/hooks/useRewardScanner.ts";
import * as rewardScanPolicyModule from "../app/lib/rewardScanPolicy.ts";
import * as claimTransactionIntentModule from "../app/lib/claimTransactionIntent.ts";

const rewardScanPolicy = rewardScanPolicyModule.default ?? rewardScanPolicyModule;
const claimTransactionIntent = claimTransactionIntentModule.default ?? claimTransactionIntentModule;

const rewardScannerNoop = () => {};

function renderRewardScanner({
  unclaimedWins = [],
  isScanning = false,
  isDeepScanning = false,
  isClaiming = false,
} = {}) {
  return renderToStaticMarkup(React.createElement(RewardScanner, {
    unclaimedWins,
    isScanning,
    isDeepScanning,
    isClaiming,
    onScan: rewardScannerNoop,
    onClaim: rewardScannerNoop,
    onClaimAll: rewardScannerNoop,
  }));
}

function assertRewardScannerPresentation() {
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
}

function assertClaimTransactionIntentPolicy(candidate) {
  const hash = `0x${"1".repeat(64)}`;
  const actor = "0x1111111111111111111111111111111111111111";
  const contract = "0x2222222222222222222222222222222222222222";
  const calldata = "0x12345678";
  const transaction = {
    hash,
    chainId: 59141,
    from: actor,
    to: contract,
    value: 0n,
    input: calldata,
    type: "eip1559",
  };
  const intent = { actor, chainId: 59141, contract, calldata };
  assert.doesNotThrow(() => candidate(intent, hash, transaction));
  for (const mutated of [
    { ...transaction, to: actor },
    { ...transaction, from: contract },
    { ...transaction, chainId: 1 },
    { ...transaction, value: 1n },
    { ...transaction, input: "0x87654321" },
    { ...transaction, type: "eip" + "7702" },
  ]) {
    assert.throws(() => candidate(intent, hash, mutated), /Claim transaction does not match/);
  }
}

async function assertClaimReceiptQuorumAndFinalityPolicy(candidate) {
  const hash = `0x${"1".repeat(64)}`;
  const actor = "0x1111111111111111111111111111111111111111";
  const contract = "0x2222222222222222222222222222222222222222";
  const calldata = "0x12345678";
  const blockHash = `0x${"2".repeat(64)}`;
  const receipt = { status: "success", transactionHash: hash, blockHash, blockNumber: 10n, transactionIndex: 1 };
  const transaction = { hash, chainId: 59141, from: actor, to: contract, value: 0n, input: calldata, type: "eip1559", blockHash, blockNumber: 10n, transactionIndex: 1, nonce: 7 };
  const client = {
    waitForTransactionReceipt: async () => receipt,
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => transaction,
    getChainId: async () => 59141,
    getBlockNumber: async () => 12n,
    getBlock: async () => ({ hash: blockHash }),
  };
  const intent = { actor, chainId: 59141, contract, calldata };
  assert.equal(await candidate(intent, hash, 1_000, [client, client]), "confirmed");
  assert.equal(
    await candidate(intent, hash, 1_000, [
      client,
      { ...client, getBlock: async () => ({ hash: `0x${"3".repeat(64)}` }) },
    ]),
    "pending",
    "a claim must stay pending when independent origins disagree about the finalized block",
  );
  const revertedReceipt = { ...receipt, status: "reverted" };
  const revertedClient = {
    ...client,
    waitForTransactionReceipt: async () => revertedReceipt,
    getTransactionReceipt: async () => revertedReceipt,
  };
  await assert.rejects(
    () => candidate(intent, hash, 1_000, [revertedClient, revertedClient]),
    /Transaction reverted/,
    "a finalized reverted receipt must not be downgraded to a successful or pending claim",
  );
  await assert.rejects(
    () => candidate(intent, hash, 1_000, [client, { ...client, getTransaction: async () => ({ ...transaction, type: "eip" + "7702" }) }]),
    /Claim transaction does not match/,
    "a receipt quorum must not override an unsupported claim transaction envelope",
  );
}

function assertAutomaticRewardScanBounds(candidate) {
  assert.deepEqual(candidate(0n), { startEpoch: 0n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(1n), { startEpoch: 0n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(2n), { startEpoch: 1n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(1_501n), { startEpoch: 1_500n, minEpoch: 1n, quickMinEpoch: 1n });
  assert.deepEqual(candidate(1_502n), { startEpoch: 1_501n, minEpoch: 1n, quickMinEpoch: 2n });
  assert.deepEqual(candidate(5_001n), { startEpoch: 5_000n, minEpoch: 1n, quickMinEpoch: 3_501n });
  assert.deepEqual(candidate(5_002n), { startEpoch: 5_001n, minEpoch: 2n, quickMinEpoch: 3_502n });
}

function assertRewardSelectionPolicy(candidate) {
  const result = candidate({
    potentialWins: [
      { id: 9n, rewardPool: 100n },
      { id: 8n, rewardPool: 100n },
      { id: 7n, rewardPool: 1n },
      { id: 6n, rewardPool: 100n },
      { id: 5n, rewardPool: 100n },
    ],
    betResults: [{ result: 5n }, { result: 5n }, { result: 1n }, { result: 0n }, {}],
    tilePoolResults: [{ result: 10n }, { result: 10n }, { result: 10n }, { result: 10n }, { result: 10n }],
    resolvedAtResults: [
      { result: 10n },
      { result: 9n },
      { result: 0n },
      { result: 10n },
      { result: 10n },
    ],
    chainTimestamp: 10n + rewardScanPolicy.REWARD_CLAIM_WINDOW_SECONDS - 1n,
  });
  assert.deepEqual(result, [{ epoch: "9", amountWei: "50" }]);

  assert.deepEqual(candidate({
    potentialWins: [{ id: 9n, rewardPool: 100n }],
    betResults: [{ result: 5n }],
    tilePoolResults: [{ result: 10n }],
    resolvedAtResults: [{ result: 10n }],
    chainTimestamp: 10n + rewardScanPolicy.REWARD_CLAIM_WINDOW_SECONDS,
  }), []);
}

export async function runRewardScannerTests() {
  const rewardScanner = rewardScannerModule.default ?? rewardScannerModule;
  assertClaimTransactionIntentPolicy(claimTransactionIntent.assertClaimTransactionMatchesIntent);
  await assertClaimReceiptQuorumAndFinalityPolicy(claimTransactionIntent.waitForClaimTransactionReceiptAgreement);
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

  assert.equal(rewardScanPolicy.AUTOMATIC_REWARD_SCAN_DEPTH, 5_000n);
  assertAutomaticRewardScanBounds(rewardScanPolicy.getAutomaticRewardScanBounds);
  const chunks = [...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(10n, 3n, 3n)];
  assert.deepEqual(chunks, [[10n, 9n, 8n], [7n, 6n, 5n], [4n, 3n]]);
  assert.deepEqual(chunks.flat(), [10n, 9n, 8n, 7n, 6n, 5n, 4n, 3n]);
  assert.deepEqual([...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(2n, 3n, 3n)], []);
  assert.throws(
    () => [...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(10n, 3n, 0n)],
    /positive/,
  );
  assert.deepEqual(rewardScanPolicy.chunkRewardScanItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.throws(() => rewardScanPolicy.chunkRewardScanItems([1], 0), /positive safe integer/);
  assertRewardSelectionPolicy(rewardScanPolicy.collectOpenRewardScanWins);

  assert.throws(
    () => assertAutomaticRewardScanBounds((epoch) => ({
      startEpoch: epoch > 1n ? epoch - 1n : 0n,
      minEpoch: epoch > 4_999n ? epoch - 4_999n : 1n,
      quickMinEpoch: epoch > 1_500n ? epoch - 1_500n : 1n,
    })),
    /Expected values to be strictly deep-equal/,
    "off-by-one scan-depth mutant must be killed",
  );
  assert.throws(
    () => assert.deepEqual(
      [...rewardScanPolicy.iterateDescendingRewardScanEpochChunks(10n, 3n, 3n)].slice(0, 1).flat(),
      [10n, 9n, 8n, 7n, 6n, 5n, 4n, 3n],
    ),
    /Expected values to be strictly deep-equal/,
    "empty-first-chunk early-stop mutant must be killed",
  );
  assert.throws(
    () => assertRewardSelectionPolicy((input) => rewardScanPolicy.collectOpenRewardScanWins({
      ...input,
      resolvedAtResults: input.resolvedAtResults.map(() => ({ result: 0n })),
    })),
    /Expected values to be strictly deep-equal/,
    "missing claim-finality timestamp binding mutant must be killed",
  );

  const rewardScannerSource = readFileSync("app/hooks/useRewardScanner.ts", "utf8");
  assert.match(
    rewardScannerSource,
    /wins\.push\(\.\.\.collectOpenRewardScanWins\(\{[\s\S]*potentialWins,[\s\S]*betResults,[\s\S]*tilePoolResults,[\s\S]*resolvedAtResults,[\s\S]*chainTimestamp,[\s\S]*\}\)\)/,
    "automatic reward scan must bind aligned multicall results to the tested claim-window policy",
  );
  assert.match(rewardScannerSource, /getExplorerTxUrl/, "single reward claim notifications must include explorer links when a tx hash is available");
  assert.match(
    rewardScannerSource,
    /const waitReceipt = useCallback[\s\S]*waitForClaimTransactionReceiptAgreement\(intent, hash, TX_RECEIPT_TIMEOUT_MS\)/,
    "reward claims must remain pending until shared quorum and finality confirmation succeeds",
  );
  assert.doesNotMatch(rewardScannerSource, /Preparing reward claims? from the Privy wallet/, "reward claim preparation toasts must stay short and avoid redundant Privy-wallet wording");
  assert.match(
    rewardScannerSource,
    /preferredAddress[\s\S]*const \{ address: connectedAddress \} = useAccount\(\)[\s\S]*getAddress\(candidate\)/,
    "reward scanning and claiming must prefer the canonical embedded wallet actor over the connected wallet",
  );
  const lineaOreHubRuntimeSource = readFileSync("app/hooks/useLineaOreHubRuntime.ts", "utf8");
  assert.match(
    lineaOreHubRuntimeSource,
    /useRewardScanner[\s\S]*enabled: activeTab === "hub" && Boolean\(embeddedWalletAddress\)[\s\S]*preferredAddress: embeddedWalletAddress[\s\S]*sendTransactionSilent: miningSendTransactionSilent/,
    "hub rewards must scan the same embedded wallet that submits claims",
  );
  assert.match(rewardScannerSource, /lastRewardClaimTxHash/, "batch reward claim notifications must keep the latest tx hash for explorer links");
  assert.match(
    rewardScannerSource,
    /const claimReward[\s\S]*let submittedHash: `0x\$\{string\}` \| null = null;[\s\S]*const hash = await silentSend\(\{ to: CONTRACT_ADDRESS, data, gas \}\);[\s\S]*submittedHash = hash;[\s\S]*submittedHash && err instanceof ClaimTransactionIntentError[\s\S]*Claim transaction submitted and is still pending\. Rewards will refresh after confirmation\.[\s\S]*submittedHash/,
    "single reward claims must preserve the submitted hash as pending when post-send intent verification cannot be confirmed",
  );
  assertRewardScannerPresentation();
  assert.match(
    rewardScannerSource,
    /const claimInFlightRef = useRef\(false\)[\s\S]*const claimReward[\s\S]*if \(claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;[\s\S]*const claimAll[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;/,
    "reward claims must synchronously prevent overlapping single and batch submissions",
  );
  assert.match(rewardScannerSource, /activeClaimAddressRef\.current = address\?\.toLowerCase\(\)[\s\S]*const claimActor = address\.toLowerCase\(\)[\s\S]*activeClaimAddressRef\.current !== claimActor[\s\S]*claimActorChanged/, "reward claims must stop sends and stale state updates when the active wallet changes");

  const deepRewardScanSource = readFileSync("app/hooks/useDeepRewardScan.ts", "utf8");
  assert.match(
    deepRewardScanSource,
    /found\.push\(\.\.\.collectOpenRewardScanWins\(\{[\s\S]*potentialWins,[\s\S]*betResults,[\s\S]*tilePoolResults,[\s\S]*resolvedAtResults,[\s\S]*chainTimestamp,[\s\S]*\}\)\)/,
    "deep reward scan must bind aligned multicall results to the tested claim-window policy",
  );
  assert.match(deepRewardScanSource, /getExplorerTxUrl/, "deep reward claim notifications must include explorer links when a tx hash is available");
  assert.match(
    deepRewardScanSource,
    /const waitReceipt = useCallback[\s\S]*waitForClaimTransactionReceiptAgreement\(intent, hash, TX_RECEIPT_TIMEOUT_MS\)/,
    "deep reward claims must remain pending until shared quorum and finality confirmation succeeds",
  );
  assert.match(deepRewardScanSource, /readJsonResponse<ClaimCandidatePage>/, "deep reward candidate scans must use the bounded JSON response helper");
  assert.match(deepRewardScanSource, /import \{ fetchWithTimeout \} from "\.\.\/lib\/fetchWithTimeout";[\s\S]*fetchWithTimeout\(`\/api\/claim-candidates\?\$\{query\.toString\(\)\}`,\s*\{ cache: "no-store" \}\)/, "deep reward candidate scans must use the shared fetch timeout helper");
  assert.doesNotMatch(deepRewardScanSource, /response\.json\(\)/, "deep reward candidate scans must not use unbounded response.json");
  assert.match(deepRewardScanSource, /const claimInFlightRef = useRef\(false\)[\s\S]*claimOne[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;[\s\S]*claimAllDeep[\s\S]*claimInFlightRef\.current\) return;[\s\S]*claimInFlightRef\.current = true;/, "deep reward claims must share a synchronous submission lock");
  assert.match(deepRewardScanSource, /claimOne[\s\S]*isAmbiguousPendingTxError\(err\)[\s\S]*!isUserRejection\(err\)[\s\S]*Reward claim rejected in wallet\./, "deep single reward claim must surface wallet rejection instead of silently clearing the claim state");
  assert.match(deepRewardScanSource, /claimOne[\s\S]*const hash = await sendTransactionSilent\(\{ to: CONTRACT_ADDRESS, data, gas \}\);[\s\S]*try \{[\s\S]*receiptState = await waitReceipt\(hash, \{[\s\S]*actor: claimActor,[\s\S]*chainId: APP_CHAIN_ID,[\s\S]*contract: CONTRACT_ADDRESS,[\s\S]*calldata: data,[\s\S]*\}\);[\s\S]*isDefinitiveClaimRevertError\(err\)[\s\S]*markPostSendClaimVerificationError\(err, hash\)[\s\S]*const postSendHash = getPostSendClaimVerificationHash\(err\);[\s\S]*Claim transaction submitted and is still pending\. Rewards will refresh after confirmation\.[\s\S]*formatRewardClaimError\(err\)/, "deep single reward claim must bind receipt confirmation to its exact transaction intent and treat unknown post-send verification as pending before generic errors");
  assert.match(deepRewardScanSource, /let claimRejected = false[\s\S]*if \(isUserRejection\(err\)\) \{[\s\S]*claimRejected = true[\s\S]*if \(claimRejected && claimedEpochs\.size === 0 && !pendingClaimTx\)[\s\S]*Reward claim rejected in wallet\./, "deep batch reward claim must surface wallet rejection when no prior claim transaction succeeded or remains pending");
  assert.match(deepRewardScanSource, /function isDefinitiveClaimRevertError\(error: unknown\)[\s\S]*startsWith\("transaction reverted"\)[\s\S]*function markPostSendClaimVerificationError\(error: unknown, hash: `0x\$\{string\}`\)[\s\S]*claimTxSubmitted = true[\s\S]*function getPostSendClaimVerificationHash\(error: unknown\)[\s\S]*claimTxSubmitted === true/, "deep reward post-send receipt verification errors must carry tx hashes unless the receipt is a definitive revert");
  assert.match(deepRewardScanSource, /const hash = await sendTransactionSilent\(\{ to: CONTRACT_ADDRESS, data, gas \}\);[\s\S]*try \{[\s\S]*receiptState = await waitReceipt\(hash, \{[\s\S]*actor: claimActor,[\s\S]*chainId: APP_CHAIN_ID,[\s\S]*contract: CONTRACT_ADDRESS,[\s\S]*calldata: data,[\s\S]*\}\);[\s\S]*isDefinitiveClaimRevertError\(err\)[\s\S]*markPostSendClaimVerificationError\(err, hash\)[\s\S]*const postSendHash = getPostSendClaimVerificationHash\(err\);[\s\S]*pendingClaimTx = true;[\s\S]*break;/, "deep reward claim-all must bind receipt confirmation to its exact transaction intent and stop further sends after an unknown post-send verification state");
  assert.match(deepRewardScanSource, /activeClaimAddressRef\.current = address\?\.toLowerCase\(\) \?\? null[\s\S]*const claimActor = address\.toLowerCase\(\)[\s\S]*activeClaimAddressRef\.current !== claimActor[\s\S]*claimActorChanged/, "deep reward claims must stop batches and stale state updates when the active wallet changes");
}
