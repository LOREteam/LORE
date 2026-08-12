import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runHubReadOnlyControlTests() {
  const miningGuardsSource = readFileSync("app/hooks/useMiningGuards.ts", "utf8");
  assert.match(miningGuardsSource, /readOnlyReason[\s\S]*notify\(readOnlyReason,\s*"warning"\)/, "mining guards must block manual betting with the read-only reason");
  assert.match(
    miningGuardsSource,
    /!isAutoMining\s*&&\s*readOnlyReason[\s\S]*notify\(readOnlyReason,\s*"warning"\)/,
    "mining guards must block starting auto-miner in read-only mode while still allowing stop",
  );
  assert.match(
    miningGuardsSource,
    /function parseDecimalNumberToUnits[\s\S]*function isBalanceBelowDecimalThreshold[\s\S]*function isBalanceBelowWholeToken/,
    "mining guards must compare wallet balances with raw bigint unit thresholds",
  );
  assert.match(
    miningGuardsSource,
    /const lowEthBalance = isBalanceBelowDecimalThreshold\(embeddedEthBalance, minEthForGas\);[\s\S]*const lowTokenBalance = isBalanceBelowWholeToken\(embeddedTokenBalance\);/,
    "mining low-balance state must use bigint threshold helpers",
  );
  assert.doesNotMatch(miningGuardsSource, /Number\(getFormattedBalance\(embedded(?:Eth|Token)Balance\)\)/, "mining low-balance state must not coerce formatted balances through Number()");

  const hubContentSource = readFileSync("app/components/HubContent.tsx", "utf8");
  assert.match(hubContentSource, /readOnlyReason[\s\S]*data-testid="hub-read-only-banner"/, "hub must show a visible read-only banner when betting is temporarily paused");
  assert.match(hubContentSource, /readOnlyReason=\{readOnlyReason\}/, "hub must pass read-only reason to desktop and mobile betting controls");
  assert.match(
    hubContentSource,
    /window\.setTimeout\([\s\S]*estimateContractGas[\s\S]*estimateFeesPerGas[\s\S]*\}, 600\)/,
    "hub fee estimate must use a debounced live gas and fee quote instead of a fixed value",
  );
  assert.match(
    hubContentSource,
    /formatBalanceFixed\(\{ value: gas \* feePerGas, decimals: 18 \}, 6\) \?\? "0\.000000"/,
    "hub fee estimate must format bigint wei without unsafe Number(formatEther()).toFixed() conversion",
  );
  assert.match(
    hubContentSource,
    /GRID_SIZE[\s\S]*selectedTilesKey\.split\(",",?\)\.map\(\(tile\) => Number\(tile\)\)\.filter\(\(tile\) => \([\s\S]*Number\.isSafeInteger\(tile\)[\s\S]*tile >= 1[\s\S]*tile <= GRID_SIZE/,
    "hub fee estimate tile mask must reject unsafe or out-of-range selected tile IDs",
  );
  assert.doesNotMatch(hubContentSource, /Number\.isInteger\(tile\) && tile > 0/, "hub fee estimate tile mask must not use positive-only selected tile guards");
  assert.doesNotMatch(hubContentSource, /Number\(formatEther\(gas \* feePerGas\)\)\.toFixed\(6\)|formatEther/, "hub fee estimate must not coerce formatted ETH through Number(formatEther())");
  assert.match(
    hubContentSource,
    /const gasPromise = CONTRACT_REQUIRES_EPOCH_BOUND_BETS[\s\S]*functionName: "placeBatchBetsBitmapForEpoch"[\s\S]*args: \[BigInt\(gridDisplayEpoch!\), selectedTileMaskForEstimate, amount\]/,
    "hub fee estimate must use the same protected epoch-bound selector as V10 bets",
  );

  const gameEpochUiStateSource = readFileSync("app/hooks/useGameEpochUiState.ts", "utf8");
  assert.doesNotMatch(gameEpochUiStateSource, /react-hooks\/exhaustive-deps/, "game epoch UI state must keep hook dependencies explicit");
  assert.match(
    gameEpochUiStateSource,
    /setVisualEpoch\(\(current\) => \(current === seededVisualEpoch \? current : seededVisualEpoch\)\)/,
    "seeded visual epoch sync must use a functional update instead of suppressing hook deps",
  );
  assert.match(
    readFileSync("app/components/HubSidePanel.tsx", "utf8"),
    /Fee \{feeEstimate \?[^\n]*feeEstimateUnavailable \? "unavailable"/,
    "mobile manual bet must show an explicit unavailable fee state",
  );

  const smokeBrowserFlowsSource = readFileSync("scripts/smoke-browser-lib/flows.mjs", "utf8");
  assert.match(smokeBrowserFlowsSource, /openWalletSelectorFromLoginModal/, "browser smoke flows must expose a wallet selector check");
  assert.match(smokeBrowserFlowsSource, /modalTimeoutMs\s*=\s*Math\.min\(timeoutMs,\s*15_000\)/, "browser smoke login modal must wait long enough for Privy auth widget");
  assert.match(smokeBrowserFlowsSource, /privyReadyTimeoutMs\s*=\s*Math\.max\(modalTimeoutMs,\s*timeoutMs\)/, "browser smoke login modal must allow the full smoke timeout for Privy readiness");
  assert.match(smokeBrowserFlowsSource, /clickVisibleEnabledButton/, "browser smoke login modal must click the visible enabled connect button");
  assert.match(smokeBrowserFlowsSource, /LOGIN TO BET[\s\S]*LOGIN TO START/, "browser smoke login modal must accept manual-bet and auto-miner guest auth entrypoints");
  assert.match(smokeBrowserFlowsSource, /!button\.disabled[\s\S]*expectedLabels\.includes/, "browser smoke login modal must wait for an enabled matching button before clicking");
  assert.match(smokeBrowserFlowsSource, /walletOptionsTimeoutMs\s*=\s*Math\.min\(timeoutMs,\s*15_000\)/, "browser smoke wallet selector must allow Privy wallet options enough time to load");
  assert.match(smokeBrowserFlowsSource, /\[data-testid="manual-bet-action"\]/, "browser smoke read-only checks must target the manual bet action by stable test id");
  assert.match(smokeBrowserFlowsSource, /\[data-testid="auto-miner-action"\]/, "browser smoke read-only checks must target the auto-miner action by stable test id");
  assert.match(
    smokeBrowserFlowsSource,
    /visibleButtonTexts\.some\(\(text\) => text\.includes\("MetaMask"\)\)[\s\S]*visibleButtonTexts\.some\(\(text\) => text\.includes\("Coinbase Wallet"\)\)/,
    "browser smoke wallet selector must verify visible MetaMask and Coinbase options",
  );
  assert.match(smokeBrowserFlowsSource, /retrying auth widget/, "browser smoke wallet selector must retry the Privy auth widget when wallet options load slowly");
  assert.match(smokeBrowserFlowsSource, /visible buttons:/, "browser smoke wallet selector failure must include visible button diagnostics");
  assert.match(smokeBrowserFlowsSource, /verifyHubVisualRegressionGuards/, "browser smoke flows must expose visual regression guards for known wallet-page regressions");
}
