import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as walletTransferRowModule from "../app/components/wallet/WalletTransferRow.tsx";
import * as walletTransferPanelsModule from "../app/components/wallet/WalletSettingsTransferPanels.tsx";
import * as pendingTxPanelModule from "../app/components/wallet/WalletSettingsPendingTxPanel.tsx";
import * as headerPoolChartModule from "../app/components/header/HeaderPoolChart.tsx";
import * as headerWalletCardModule from "../app/components/header/HeaderWalletCard.tsx";
import * as sectionBuildersModule from "../app/lib/lineaOreClientSectionBuilders.ts";
import * as pageWalletOverviewModule from "../app/hooks/usePageWalletOverview.ts";
import * as betPanelModule from "../app/components/BetPanel.tsx";
import * as walletSettingsModalModule from "../app/components/WalletSettingsModal.tsx";

const walletTransferRow = walletTransferRowModule.default ?? walletTransferRowModule;
const walletTransferPanels = walletTransferPanelsModule.default ?? walletTransferPanelsModule;
const pageWalletOverview = pageWalletOverviewModule.default ?? pageWalletOverviewModule;
const normalizeCachedPrivyBalances = pageWalletOverview.normalizeCachedPrivyBalances;
const getCachedPrivyBalancesForKey = pageWalletOverview.getCachedPrivyBalancesForKey;
const pendingTxPanel = pendingTxPanelModule.default ?? pendingTxPanelModule;
const headerPoolChart = headerPoolChartModule.default ?? headerPoolChartModule;
const headerWalletCard = headerWalletCardModule.default ?? headerWalletCardModule;
const sectionBuilders = sectionBuildersModule.default ?? sectionBuildersModule;
const betPanel = betPanelModule.default ?? betPanelModule;
const walletSettingsModal = walletSettingsModalModule.default ?? walletSettingsModalModule;

const READY_BALANCE_STATUS = Object.freeze({ fetching: false, error: false, stale: false, updatedAt: null });

function assertTransferPresentation(input, actual) {
  const expectedState = input.loading ? "pending" : input.disabled ? "unavailable" : "ready";
  assert.equal(actual.state, expectedState);
  assert.equal(actual.actionLabel, input.loading
    ? `${input.buttonLabel} in progress`
    : input.disabled
      ? `${input.buttonLabel} unavailable`
      : input.buttonLabel);
  assert.equal(actual.buttonText, input.loading ? "Sending..." : input.buttonLabel);
  assert.equal(actual.announce, input.loading);
}

function assertPendingPresentation(input, actual) {
  const hasPending = Boolean(input.pendingTransactionStatus?.nonceGap > 0);
  const busy = input.isRefreshingPendingTx || input.isCancellingPendingTx || Boolean(input.busyAction);
  assert.equal(actual.state, input.pendingTransactionStatus ? (hasPending ? "blocked" : "clear") : "unchecked");
  assert.equal(actual.hasPending, hasPending);
  assert.equal(actual.busy, busy);
  assert.equal(actual.checkDisabled, busy);
  assert.equal(actual.clearDisabled, busy || !hasPending);
  assert.equal(actual.replacementDisabled, busy || !/^0x[0-9a-fA-F]{64}$/.test(input.replacementHash.trim()));
  if (input.busyAction === "nonce-check") {
    assert.equal(actual.checkButtonText, "Checking...");
    assert.match(actual.checkLabel, /^Checking latest and pending nonces/);
    assert.match(actual.busyAnnouncement, /^Checking latest and pending nonces/);
    assert.equal(actual.replacementButtonText, "Verify Replacement");
  } else if (input.busyAction === "replacement") {
    assert.equal(actual.checkButtonText, "Check");
    assert.equal(actual.replacementButtonText, "Verifying replacement...");
    assert.match(actual.replacementLabel, /^Verifying exact wallet transfer replacement/);
    assert.match(actual.busyAnnouncement, /^Verifying replacement transaction/);
  }
}

export function runWalletPresentationTests() {
  const hubSidePanelSourceForTypography = readFileSync("app/components/HubSidePanel.tsx", "utf8");
  const connectedWalletAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const walletSettingsModalHtml = renderToStaticMarkup(React.createElement(
    walletSettingsModal.WalletSettingsModal,
    {
      isOpen: true,
      onClose: () => undefined,
      connectedWalletAddress,
      embeddedWalletAddress: connectedWalletAddress.toLowerCase(),
      externalWalletAddress: null,
      formattedLineaBalance: "0.00",
      formattedEthBalance: "0.0000",
      withdrawAmount: "",
      withdrawEthAmount: "",
      depositEthAmount: "",
      depositTokenAmount: "",
      isWithdrawing: false,
      isWithdrawingEth: false,
      isDepositingEth: false,
      isDepositingToken: false,
      onWithdrawAmountChange: () => undefined,
      onWithdrawEthAmountChange: () => undefined,
      onDepositEthAmountChange: () => undefined,
      onDepositTokenAmountChange: () => undefined,
      onCreateEmbeddedWallet: async () => undefined,
      walletSetupCreating: false,
      walletSetupError: null,
      onCopyEmbeddedAddress: () => undefined,
      onExportEmbeddedWallet: () => undefined,
      onWithdrawToExternal: () => undefined,
      onWithdrawEthToExternal: () => undefined,
      onDepositEthToEmbedded: () => undefined,
      onDepositTokenToEmbedded: () => undefined,
      walletTransfers: null,
      walletTransfersLoading: false,
      onLoadWalletTransfers: () => undefined,
      deepScanWins: null,
      deepScanScanning: false,
      deepScanClaiming: false,
      deepScanProgress: "",
      onDeepScan: () => undefined,
      onDeepScanStop: () => undefined,
      onDeepClaimOne: () => undefined,
      onDeepClaimAll: () => undefined,
      connectedResolverRewards: "1.00",
      connectedResolverRewardsWei: 1n,
      embeddedResolverRewards: "2.00",
      embeddedResolverRewardsWei: 2n,
      isClaimingConnectedResolverRewards: false,
      isClaimingEmbeddedResolverRewards: false,
      onClaimConnectedResolverRewards: () => undefined,
      onClaimEmbeddedResolverRewards: () => undefined,
      pendingTransactionStatus: null,
      isRefreshingPendingTx: false,
      isCancellingPendingTx: false,
      onRefreshPendingTx: () => undefined,
      onCancelPendingTx: () => undefined,
    },
  ));
  assert.match(
    walletSettingsModalHtml,
    /<div(?=[^>]*role="dialog")(?=[^>]*aria-modal="true")(?=[^>]*aria-labelledby="wallet-settings-title")(?=[^>]*aria-describedby="wallet-settings-description")(?=[^>]*tabindex="-1")[^>]*>/,
    "rendered wallet settings modal must expose complete dialog semantics",
  );
  assert.match(
    walletSettingsModalHtml,
    /class="[^"]*max-h-\[calc\(100dvh-1rem\)\][^"]*sm:max-h-\[calc\(100dvh-2rem\)\][^"]*"/,
    "rendered Wallet Settings modal must stay inside the dynamic viewport",
  );
  assert.match(
    walletSettingsModalHtml,
    /class="[^"]*min-h-0[^"]*flex-1[^"]*overflow-y-auto[^"]*"/,
    "rendered Wallet Settings content must shrink and scroll inside the modal",
  );
  assert.match(
    walletSettingsModalHtml,
    /<button(?=[^>]*aria-label="Export support logs")(?=[^>]*title="Export support logs")[^>]*>[\s\S]*?<span class="hidden sm:inline">Export Logs<\/span>[\s\S]*?<\/button>/,
    "rendered support-log action must preserve its accessible name, title, and desktop label",
  );
  const mobileSectionButtons = [
    ...walletSettingsModalHtml.matchAll(/<button\b(?=[^>]*aria-pressed="(?:true|false)")[^>]*>([^<]+)<\/button>/g),
  ].map((match) => ({ markup: match[0], label: match[1] }));
  assert.deepEqual(
    {
      labels: mobileSectionButtons.map(({ label }) => label),
      selectedLabels: mobileSectionButtons
        .filter(({ markup }) => /aria-pressed="true"/.test(markup))
        .map(({ label }) => label),
    },
    {
      labels: ["All", "General", "Privy", "Transfer", "Scan"],
      selectedLabels: ["All"],
    },
    "rendered mobile Wallet Settings navigation must expose all sections with exactly one selected",
  );
  assert.ok(
    mobileSectionButtons.every(({ markup }) => /class="[^"]*min-h-11[^"]*focus-visible:ring-2[^"]*"/.test(markup)),
    "rendered mobile Wallet Settings sections must keep a 44px touch target and visible keyboard focus",
  );
  assert.deepEqual(
    [/Claim Connected/.test(walletSettingsModalHtml), /Claim Privy/.test(walletSettingsModalHtml)],
    [true, false],
    "normalized-equivalent connected and embedded addresses must not render a duplicate resolver claim",
  );
  assert.match(
    hubSidePanelSourceForTypography,
    /value=\{manualBetForm\.betAmount\}[\s\S]*lore-nums h-11 w-full[\s\S]*tabular-nums[\s\S]*focus-visible:ring-2/,
    "mobile compact manual bet amount input must keep the shared numeric font class and visible keyboard focus",
  );
  assert.match(
    hubSidePanelSourceForTypography,
    /aria-label="Exact total stake"[\s\S]*lore-nums[\s\S]*tabular-nums[\s\S]*\{exactTotal \?\? "Unavailable"\} LINEA/,
    "mobile compact manual bet total must use the shared numeric font class",
  );
  const manualBetPanelHtml = renderToStaticMarkup(React.createElement(betPanel.ManualBetPanel, {
    formattedBalance: "100.00",
    walletAuthenticated: true,
    walletConnected: true,
    selectedTilesCount: 3,
    feeEstimate: null,
    feeEstimateUnavailable: true,
    isPending: false,
    isRevealing: false,
    isAutoMining: false,
    readOnlyReason: "Betting is temporarily read-only.",
    manualBetForm: {
      betAmount: "1",
      setBetAmount: () => undefined,
      totalBetDisplay: "3.00",
      betAmountError: null,
      balanceDisplay: "100.00",
      lineaDeficitDisplay: "0.00",
      manualInsufficient: false,
      disabledReason: null,
      isDisabled: false,
    },
    onMine: () => undefined,
    onQuickPickTiles: () => undefined,
  }));
  assert.match(
    manualBetPanelHtml,
    /<input(?=[^>]*id="bet-amount-per-tile")(?=[^>]*class="[^"]*console-input[^"]*lore-nums[^"]*h-11)[^>]*>/,
    "rendered manual bet amount must use the shared numeric font class and 44px touch height",
  );
  assert.match(
    manualBetPanelHtml,
    /data-testid="manual-bet-action"/,
    "rendered manual bet primary action must expose its stable smoke-test selector",
  );
  assert.match(
    manualBetPanelHtml,
    /id="manual-bet-readonly-reason"[\s\S]*data-testid="manual-bet-action"[^>]*aria-describedby="manual-bet-readonly-reason"/,
    "rendered manual bet action must reference its visible read-only reason",
  );
  assert.match(
    manualBetPanelHtml,
    /role="status" aria-live="polite" aria-atomic="true">Betting is temporarily read-only\.<\/span>/,
    "rendered manual bet state transition must be announced",
  );
  assert.match(
    manualBetPanelHtml,
    /<span>Bet network fee<\/span><span class="lore-nums text-sky-200">Unavailable<\/span>/,
    "rendered manual bet must show an explicit unavailable network-fee state",
  );
  const autoMinerForm = {
    betSize: "1",
    setBetSize: () => undefined,
    targets: 3,
    cycles: 2,
    displayBetSize: "1",
    displayTargets: "3",
    displayCycles: "2",
    totalCost: 6,
    betSizeError: null,
    balance: 100,
    insufficientBalance: false,
    disabledReason: null,
    isDisabled: false,
    handleTargetsChange: () => undefined,
    handleCyclesChange: () => undefined,
  };
  const insufficientAutoMinerHtml = renderToStaticMarkup(React.createElement(betPanel.AutoMinerPanel, {
    form: {
      ...autoMinerForm,
      balance: 4,
      insufficientBalance: true,
      disabledReason: "Insufficient LINEA balance",
      isDisabled: true,
    },
    autoMinePhase: "idle",
    isAutoMining: false,
    isPending: false,
    isRevealing: false,
    walletAuthenticated: true,
    walletConnected: true,
    onToggle: () => undefined,
  }));
  assert.equal(
    (insufficientAutoMinerHtml.match(/<input(?=[^>]*class="[^"]*console-input lore-nums[^"]*")[^>]*>/g) ?? []).length,
    3,
    "all rendered auto-miner numeric inputs must keep the shared numeric font class",
  );
  assert.match(
    insufficientAutoMinerHtml,
    /Need 6\.00, have 4\.00; top up 2\.00 LINEA/,
    "rendered auto-miner insufficient-balance copy must show the exact LINEA top-up deficit",
  );
  assert.match(
    insufficientAutoMinerHtml,
    /<button(?=[^>]*data-testid="auto-miner-action")(?=[^>]*aria-describedby="auto-miner-disabled-reason")[^>]*>[\s\S]*?<p id="auto-miner-disabled-reason"[^>]*>Insufficient LINEA balance<\/p>/,
    "rendered auto-miner action must reference its visible disabled reason",
  );
  const retryWaitAutoMinerHtml = renderToStaticMarkup(React.createElement(betPanel.AutoMinerPanel, {
    form: autoMinerForm,
    autoMinePhase: "retry-wait",
    isAutoMining: false,
    isPending: false,
    isRevealing: false,
    walletAuthenticated: true,
    walletConnected: true,
    onToggle: () => undefined,
  }));
  assert.match(
    retryWaitAutoMinerHtml,
    /data-testid="auto-miner-action"/,
    "rendered auto-miner primary action must expose its stable smoke-test selector",
  );
  assert.match(
    retryWaitAutoMinerHtml,
    /role="status" aria-live="polite" aria-atomic="true">Auto-miner Recovery queued\./,
    "rendered auto-miner recovery phase must be announced",
  );
  assert.match(
    retryWaitAutoMinerHtml,
    /Auto-miner is paused while the previous run settles\. It will resume automatically\./,
    "recovery progress must remain visible after the active loop pauses",
  );
  const idleAutoMinerHtml = renderToStaticMarkup(React.createElement(betPanel.AutoMinerPanel, {
    form: autoMinerForm,
    autoMinePhase: "idle",
    autoMineProgress: "synthetic hidden idle progress",
    isAutoMining: false,
    isPending: false,
    isRevealing: false,
    walletAuthenticated: true,
    walletConnected: true,
    onToggle: () => undefined,
  }));
  assert.doesNotMatch(
    idleAutoMinerHtml,
    /synthetic hidden idle progress/,
    "idle auto-miner progress must remain hidden when no recovery or active loop is present",
  );
  const transferInputs = [
    { buttonLabel: "Send ETH", disabled: false, loading: false },
    { buttonLabel: "Send ETH", disabled: true, loading: false },
    { buttonLabel: "Send ETH", disabled: true, loading: true },
  ];
  for (const input of transferInputs) {
    assertTransferPresentation(
      input,
      walletTransferRow.getWalletTransferRowPresentation(input.buttonLabel, input.disabled, input.loading),
    );
  }
  const pendingTransferHtml = renderToStaticMarkup(React.createElement(walletTransferRow.WalletTransferRow, {
    assetLabel: "ETH",
    assetVariant: "secondary",
    value: "1.25",
    onChange: () => undefined,
    placeholder: "ETH amount",
    buttonLabel: "Send ETH",
    onSubmit: () => undefined,
    disabled: true,
    loading: true,
    buttonVariant: "secondary",
  }));
  assert.match(pendingTransferHtml, /data-transfer-action-state="pending"/);
  assert.match(pendingTransferHtml, /role="status"[^>]*aria-live="polite"[^>]*>Send ETH in progress/);
  assert.match(pendingTransferHtml, /aria-busy="true"/);
  assert.match(pendingTransferHtml, /<input[^>]*maxLength="20"[^>]*aria-label="ETH transfer amount"/);
  assert.match(pendingTransferHtml, /aria-label="Send ETH in progress"[^>]*title="Send ETH in progress"/);
  assert.match(pendingTransferHtml, />Sending\.\.\.<\/button>/);
  const unavailableTransferHtml = renderToStaticMarkup(React.createElement(walletTransferRow.WalletTransferRow, {
    assetLabel: "LINEA",
    assetVariant: "sky",
    value: "",
    onChange: () => undefined,
    placeholder: "LINEA amount",
    buttonLabel: "Send LINEA",
    onSubmit: () => undefined,
    disabled: true,
    loading: false,
    buttonVariant: "sky",
  }));
  assert.match(unavailableTransferHtml, /data-transfer-action-state="unavailable"/);
  assert.match(unavailableTransferHtml, /<button[^>]*disabled=""[^>]*aria-label="Send LINEA unavailable"/);
  assert.doesNotMatch(unavailableTransferHtml, /role="status"/);

  const correctTransferPending = walletTransferRow.getWalletTransferRowPresentation("Send ETH", true, true);
  for (const mutant of [
    { ...correctTransferPending, state: "ready" },
    { ...correctTransferPending, actionLabel: "Send ETH" },
    { ...correctTransferPending, announce: false },
  ]) {
    assert.throws(
      () => assertTransferPresentation({ buttonLabel: "Send ETH", disabled: true, loading: true }, mutant),
      undefined,
      "wallet transfer presentation invariant must reject pending-state mutants",
    );
  }
  assert.deepEqual(
    normalizeCachedPrivyBalances(undefined),
    { token: null, tokenUpdatedAt: null, eth: null, ethUpdatedAt: null },
    "missing cached wallet balances must remain unknown instead of becoming zero",
  );
  assert.deepEqual(
    normalizeCachedPrivyBalances({ token: "not-a-number", eth: "Infinity" }),
    { token: null, tokenUpdatedAt: null, eth: null, ethUpdatedAt: null },
    "invalid cached wallet balances must remain unknown instead of becoming zero",
  );
  assert.deepEqual(
    normalizeCachedPrivyBalances({ token: "0", eth: "0" }),
    { token: "0.00", tokenUpdatedAt: null, eth: "0.0000", ethUpdatedAt: null },
    "a verified literal zero must remain distinguishable from an unavailable balance",
  );
  const walletACacheEntry = {
    cacheKey: "lore:privy-balances:v1:test:wallet-a",
    balances: {
      token: "42.00",
      tokenUpdatedAt: 1_700_000_000_000,
      eth: "1.2500",
      ethUpdatedAt: 1_700_000_001_000,
    },
  };
  const walletBKey = "lore:privy-balances:v1:test:wallet-b";
  const walletBCache = getCachedPrivyBalancesForKey(walletACacheEntry, walletBKey);
  assert.deepEqual(
    walletBCache,
    { token: null, tokenUpdatedAt: null, eth: null, ethUpdatedAt: null },
    "an A-to-B wallet switch must not render A cache while B is pending or failed",
  );
  assert.equal(
    headerWalletCard.getHeaderWalletBalancePresentation("LINEA", walletBCache.token ?? "—", { ...READY_BALANCE_STATUS, fetching: true }).state,
    "loading",
    "B pending must not reuse A token balance",
  );
  const walletBError = headerWalletCard.getHeaderWalletBalancePresentation(
    "ETH",
    walletBCache.eth ?? "—",
    { ...READY_BALANCE_STATUS, error: true },
  );
  assert.equal(walletBError.state, "error", "B RPC error must not reuse A ETH balance");
  assert.doesNotMatch(walletBError.text, /42|1\.25/, "B error text must not disclose A cached balances");
  assert.deepEqual(
    normalizeCachedPrivyBalances({ token: "42", tokenUpdatedAt: 1_700_000_000_000, eth: "1.25", ethUpdatedAt: 1_700_000_001_000 }),
    walletACacheEntry.balances,
    "current cache entries persist per-asset validated last-update timestamps",
  );
  assert.equal(
    pageWalletOverview.isHeaderLineaBalanceLoading(true, null, null),
    true,
    "a first embedded balance read with no data must show loading",
  );
  assert.equal(
    pageWalletOverview.isHeaderLineaBalanceLoading(false, null, null),
    false,
    "a completed unavailable embedded balance read must not look like perpetual loading",
  );
  assert.equal(
    pageWalletOverview.isHeaderLineaBalanceLoading(true),
    true,
    "a pending refresh must reach the Header so cached values can be labeled honestly",
  );
  const unavailableTransferSummary = {
    transfers: [],
    totalIn: 0,
    totalOut: 0,
    totalInDisplay: "0.00",
    totalOutDisplay: "0.00",
    dataStatus: "error",
    scanCoverage: null,
    historyRowsTruncated: false,
    updatedAt: null,
    statusMessage: "Transfer history is temporarily unavailable. Check your network connection and try again.",
  };
  const transferPanelProps = {
    embeddedWalletAddress: "0x1111111111111111111111111111111111111111",
    externalWalletAddress: "0x2222222222222222222222222222222222222222",
    formattedLineaBalance: null,
    formattedEthBalance: null,
    withdrawAmount: "",
    withdrawEthAmount: "",
    isWithdrawing: false,
    isWithdrawingEth: false,
    walletTransfers: unavailableTransferSummary,
    walletTransfersLoading: false,
    onWithdrawAmountChange: () => undefined,
    onWithdrawEthAmountChange: () => undefined,
    onWithdrawToExternal: () => undefined,
    onWithdrawEthToExternal: () => undefined,
    onLoadWalletTransfers: () => undefined,
  };
  const loadingTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    {
      ...transferPanelProps,
      walletTransfers: null,
      walletTransfersLoading: true,
    },
  ));
  assert.match(
    loadingTransferPanelHtml,
    /role="status" aria-live="polite">Loading LINEA transfer history<\/span>/,
    "loading transfer history must announce its current state",
  );
  assert.match(
    loadingTransferPanelHtml,
    /<button[^>]*disabled=""[^>]*aria-label="Loading LINEA transfer history"[^>]*title="Loading LINEA transfer history"/,
    "loading transfer history must expose the same state-aware accessible name and title",
  );
  const unavailableTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    transferPanelProps,
  ));
  assert.match(unavailableTransferPanelHtml, /LINEA Balance: <span[^>]*>Unavailable<\/span>/);
  assert.match(unavailableTransferPanelHtml, /ETH Balance: <span[^>]*>Unavailable<\/span>/);
  assert.match(unavailableTransferPanelHtml, /Transfer totals unavailable until a successful refresh\./);
  assert.match(unavailableTransferPanelHtml, />Try again<\/button>/);
  assert.doesNotMatch(unavailableTransferPanelHtml, /Deposited<\/div>[\s\S]*?0\.00/);
  assert.doesNotMatch(unavailableTransferPanelHtml, /Withdrawn<\/div>[\s\S]*?0\.00/);
  const verifiedZeroTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    {
      ...transferPanelProps,
      formattedLineaBalance: "0.00",
      formattedEthBalance: "0.0000",
      walletTransfers: {
        ...unavailableTransferSummary,
        dataStatus: "live",
        scanCoverage: "full",
        historyRowsTruncated: false,
        statusMessage: null,
      },
    },
  ));
  assert.match(verifiedZeroTransferPanelHtml, /LINEA Balance: <span[^>]*>0\.00 LINEA<\/span>/);
  assert.match(verifiedZeroTransferPanelHtml, /ETH Balance: <span[^>]*>0\.0000 ETH<\/span>/);
  assert.match(verifiedZeroTransferPanelHtml, /Deposited<\/div>[\s\S]*?0\.00/);
  assert.match(verifiedZeroTransferPanelHtml, /Withdrawn<\/div>[\s\S]*?0\.00/);
  assert.doesNotMatch(verifiedZeroTransferPanelHtml, /Observed deposits|lower bound/);
  const exactDisplayTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    {
      ...transferPanelProps,
      walletTransfers: {
        ...unavailableTransferSummary,
        dataStatus: "live",
        scanCoverage: "full",
        totalIn: 12.345,
        totalOut: 6.789,
        totalInDisplay: "9007199254740993.56",
        totalOutDisplay: "0.000000000000000001",
        statusMessage: null,
      },
    },
  ));
  assert.match(
    exactDisplayTransferPanelHtml,
    /<div class="lore-nums [^"]*">9007199254740993\.56<\/div>/,
    "deposit totals must render the bigint-safe display string with the shared numeric font",
  );
  assert.match(
    exactDisplayTransferPanelHtml,
    /<div class="lore-nums [^"]*">0\.000000000000000001<\/div>/,
    "withdrawal totals must render the bigint-safe display string with the shared numeric font",
  );
  assert.doesNotMatch(
    exactDisplayTransferPanelHtml,
    />12\.35<\/div>|>6\.79<\/div>/,
    "numeric compatibility totals must not replace the exact display strings",
  );
  const emptyPartialTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    {
      ...transferPanelProps,
      formattedLineaBalance: "0.00",
      formattedEthBalance: "0.0000",
      walletTransfers: {
        ...unavailableTransferSummary,
        dataStatus: "partial",
        scanCoverage: "partial",
        historyRowsTruncated: false,
        updatedAt: 1_700_000_000_000,
        statusMessage: "Transfer history is partial; observed records may be missing.",
      },
    },
  ));
  assert.match(emptyPartialTransferPanelHtml, /Observed deposits/);
  assert.match(emptyPartialTransferPanelHtml, /Observed withdrawals/);
  assert.match(emptyPartialTransferPanelHtml, /LINEA · lower bound/);
  assert.match(emptyPartialTransferPanelHtml, /Partial history: totals are observed lower bounds\./);
  assert.match(emptyPartialTransferPanelHtml, /Last checked/);
  assert.match(emptyPartialTransferPanelHtml, /No transfers were observed in this partial scan; more may exist\./);
  assert.doesNotMatch(emptyPartialTransferPanelHtml, /Saved transfer list is capped|No verified LINEA transfers were found/);
  const stalePartialTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    {
      ...transferPanelProps,
      formattedLineaBalance: "0.00",
      formattedEthBalance: "0.0000",
      walletTransfers: {
        ...unavailableTransferSummary,
        dataStatus: "stale",
        scanCoverage: "partial",
        historyRowsTruncated: false,
        updatedAt: 1_700_000_000_000,
        statusMessage: "Showing the last checked partial transfer history. Totals are observed lower bounds; more transfers may exist. Refresh to check for newer activity.",
      },
    },
  ));
  assert.match(stalePartialTransferPanelHtml, /Showing the last checked partial transfer history\. Totals are observed lower bounds; more transfers may exist\./);
  assert.match(stalePartialTransferPanelHtml, /Observed deposits/);
  assert.doesNotMatch(stalePartialTransferPanelHtml, /Full history range checked\./);
  const observedPartialTransfers = [
    {
      direction: "in",
      counterparty: "0x2222222222222222222222222222222222222222",
      amount: "12.50",
      amountNum: 12.5,
      txHash: `0x${"c".repeat(64)}`,
      blockNumber: 123456n,
      transactionIndex: 1,
      logIndex: 1,
    },
    {
      direction: "out",
      counterparty: "0x2222222222222222222222222222222222222222",
      amount: "2.25",
      amountNum: 2.25,
      txHash: `0x${"d".repeat(64)}`,
      blockNumber: 123455n,
      transactionIndex: 0,
      logIndex: 0,
    },
  ];
  const observedPartialTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    {
      ...transferPanelProps,
      formattedLineaBalance: "0.00",
      formattedEthBalance: "0.0000",
      walletTransfers: {
        ...unavailableTransferSummary,
        transfers: observedPartialTransfers,
        dataStatus: "partial",
        scanCoverage: "partial",
        historyRowsTruncated: false,
        totalIn: 12.5,
        totalOut: 2.25,
        totalInDisplay: "12.50",
        totalOutDisplay: "2.25",
        updatedAt: 1_700_000_000_000,
        statusMessage: "Transfer history is partial; observed records may be missing.",
      },
    },
  ));
  assert.match(observedPartialTransferPanelHtml, /Observed deposits/);
  assert.match(observedPartialTransferPanelHtml, /Observed withdrawals/);
  assert.match(observedPartialTransferPanelHtml, /12\.50|2\.25/);
  assert.match(observedPartialTransferPanelHtml, /role="list" aria-label="LINEA transfer history"/);
  assert.equal(
    (observedPartialTransferPanelHtml.match(/role="listitem"/g) ?? []).length,
    2,
    "each observed transfer must retain list-item semantics",
  );
  assert.match(
    observedPartialTransferPanelHtml,
    /<a[^>]*aria-label="Open inbound LINEA transfer on Lineascan"[^>]*title="Open inbound LINEA transfer on Lineascan"[^>]*class="[^"]*min-h-11[^"]*text-\[11px\][^"]*focus-visible:ring-2[^"]*"/,
    "rendered transfer Explorer links must expose a clear label, readable target, and keyboard focus ring",
  );
  assert.doesNotMatch(observedPartialTransferPanelHtml, /No transfers were observed in this partial scan/);
  const cappedFullTransferRows = Array.from({ length: 500 }, (_, index) => ({
    direction: "in",
    counterparty: "0x2222222222222222222222222222222222222222",
    amount: "1.00",
    amountNum: 1,
    txHash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    blockNumber: BigInt(index + 1),
    transactionIndex: 0,
    logIndex: 0,
  }));
  const cappedFullTransferPanelHtml = renderToStaticMarkup(React.createElement(
    walletTransferPanels.WalletSettingsTransferPanels,
    {
      ...transferPanelProps,
      formattedLineaBalance: "0.00",
      formattedEthBalance: "0.0000",
      walletTransfers: {
        ...unavailableTransferSummary,
        transfers: cappedFullTransferRows,
        dataStatus: "stale",
        scanCoverage: "full",
        historyRowsTruncated: true,
        totalIn: 501,
        totalOut: 0,
        totalInDisplay: "501.00",
        totalOutDisplay: "0.00",
        updatedAt: 1_700_000_000_000,
        statusMessage: "Showing the last checked transfer history.",
      },
    },
  ));
  assert.match(cappedFullTransferPanelHtml, /Deposited/);
  assert.match(cappedFullTransferPanelHtml, /Withdrawn/);
  assert.match(cappedFullTransferPanelHtml, /Saved transfer list is capped; totals reflect the full last check\./);
  assert.match(cappedFullTransferPanelHtml, /aria-label="LINEA transfer history"/);
  assert.doesNotMatch(cappedFullTransferPanelHtml, /Observed deposits|lower bound/);
  const headerBuilderBase = {
    actualCurrentEpoch: 1,
    gridDisplayEpoch: 1,
    currentRoundEvidence: null,
    visualEpoch: 1,
    isRevealing: false,
    coldBootDefaults: false,
    liveStateReady: true,
    timerReady: true,
    timeLeft: 0,
    rolloverAmount: 0,
    jackpotInfo: null,
    embeddedWalletAddress: null,
    embeddedWalletSyncing: false,
    formattedPrivyEthBalance: null,
    headerEthBalanceStatus: READY_BALANCE_STATUS,
    headerLineaBalance: null,
    headerLineaBalanceStatus: READY_BALANCE_STATUS,
    openWalletSettings: () => undefined,
    soundMuted: false,
    toggleSoundMute: () => undefined,
    recentWins: [],
    jackpotHistory: [],
    reducedMotion: true,
    isPageVisible: true,
    epochDurationChange: null,
  };
  const unknownHeaderProps = sectionBuilders.buildHeaderProps(headerBuilderBase);
  assert.equal(unknownHeaderProps.privyTokenBalance, "—");
  assert.equal(unknownHeaderProps.privyEthBalance, "—");
  const verifiedZeroHeaderProps = sectionBuilders.buildHeaderProps({
    ...headerBuilderBase,
    headerLineaBalance: "0.00",
    formattedPrivyEthBalance: "0.0000",
  });
  assert.equal(verifiedZeroHeaderProps.privyTokenBalance, "0.00");
  assert.equal(verifiedZeroHeaderProps.privyEthBalance, "0.0000");
  assert.deepEqual(
    headerWalletCard.getHeaderWalletBalancePresentation("LINEA", "—", READY_BALANCE_STATUS),
    { state: "unavailable", text: "Unavailable", suffix: "LINEA", label: "LINEA balance unavailable" },
  );
  assert.deepEqual(
    headerWalletCard.getHeaderWalletBalancePresentation("LINEA", "0.00", READY_BALANCE_STATUS),
    { state: "ready", text: "0.00", suffix: "LINEA", label: "LINEA balance 0.00" },
  );
  assert.equal(headerWalletCard.getHeaderWalletBalancePresentation("ETH", "—", { ...READY_BALANCE_STATUS, fetching: true }).state, "loading");
  assert.deepEqual(
    headerWalletCard.getHeaderWalletBalancePresentation("ETH", "0.0000", { ...READY_BALANCE_STATUS, fetching: true }),
    {
      state: "refreshing",
      text: "0.0000",
      suffix: "ETH",
      label: "ETH balance refreshing; showing last known 0.0000",
    },
    "a known literal zero or cached balance must remain visible while its refresh runs",
  );
  const unavailableHeaderWalletHtml = renderToStaticMarkup(React.createElement(headerWalletCard.HeaderWalletCard, {
    authenticated: true,
    loginState: {
      busy: false,
      buttonText: "Login / Connect",
      disabled: false,
      error: null,
      modalOpen: false,
      statusAnnouncement: "Wallet connected.",
    },
    embeddedWalletAddress: "0x1111111111111111111111111111111111111111",
    embeddedWalletSyncing: false,
    embeddedAddressCopied: false,
    onCopyEmbeddedAddress: () => undefined,
    onLogin: () => undefined,
    onLogout: () => undefined,
    onOpenWalletSettings: () => undefined,
    privyEthBalance: "—",
    privyEthBalanceStatus: READY_BALANCE_STATUS,
    privyTokenBalance: "—",
    privyTokenBalanceStatus: READY_BALANCE_STATUS,
  }));
  assert.match(unavailableHeaderWalletHtml, /aria-label="ETH balance unavailable"[^>]*data-balance-state="unavailable"/);
  assert.match(unavailableHeaderWalletHtml, /Unavailable<span[^>]*> ETH<\/span>/);
  assert.match(unavailableHeaderWalletHtml, /aria-label="LINEA balance unavailable"[^>]*data-balance-state="unavailable"/);
  assert.match(unavailableHeaderWalletHtml, /Unavailable<span[^>]*> LINEA<\/span>/);
  assert.match(
    unavailableHeaderWalletHtml,
    /<button[^>]*aria-label="Copy Privy wallet address"[^>]*class="[^"]*min-h-11[^"]*text-\[11px\][^"]*focus-visible:ring-2[^"]*"/,
    "rendered wallet copy action must keep its readable accessible label, target, and keyboard focus ring",
  );
  assert.match(
    unavailableHeaderWalletHtml,
    /<a[^>]*class="[^"]*min-h-11 min-w-11[^"]*focus-visible:ring-2[^"]*"[^>]*aria-label="Open Privy wallet address in explorer"/,
    "rendered wallet Explorer action must keep its accessible label, target, and keyboard focus ring",
  );
  const refreshingHeaderWalletHtml = renderToStaticMarkup(React.createElement(headerWalletCard.HeaderWalletCard, {
    authenticated: true,
    loginState: {
      busy: false,
      buttonText: "Login / Connect",
      disabled: false,
      error: null,
      modalOpen: false,
      statusAnnouncement: "Wallet connected.",
    },
    embeddedWalletAddress: "0x1111111111111111111111111111111111111111",
    embeddedWalletSyncing: false,
    embeddedAddressCopied: false,
    onCopyEmbeddedAddress: () => undefined,
    onLogin: () => undefined,
    onLogout: () => undefined,
    onOpenWalletSettings: () => undefined,
    privyEthBalance: "0.0000",
    privyEthBalanceStatus: { ...READY_BALANCE_STATUS, fetching: true },
    privyTokenBalance: "0.00",
    privyTokenBalanceStatus: { ...READY_BALANCE_STATUS, fetching: true },
  }));
  assert.match(refreshingHeaderWalletHtml, /aria-label="ETH balance refreshing; showing last known 0\.0000"[^>]*data-balance-state="refreshing"/);
  assert.match(refreshingHeaderWalletHtml, />0\.0000<span[^>]*> ETH<\/span><span[^>]*>Refreshing<\/span>/);
  assert.match(refreshingHeaderWalletHtml, /aria-label="LINEA balance refreshing; showing last known 0\.00"[^>]*data-balance-state="refreshing"/);
  assert.match(refreshingHeaderWalletHtml, />0\.00<span[^>]*> LINEA<\/span><span[^>]*>Refreshing<\/span>/);
  assert.equal(
    headerWalletCard.getHeaderWalletBalancePresentation("ETH", "0.0000", { ...READY_BALANCE_STATUS, stale: true }).state,
    "stale",
  );
  assert.equal(
    headerWalletCard.getHeaderWalletBalancePresentation("LINEA", "0.00", { ...READY_BALANCE_STATUS, error: true }).state,
    "error",
  );
  const staleErrorHeaderWalletHtml = renderToStaticMarkup(React.createElement(headerWalletCard.HeaderWalletCard, {
    authenticated: true,
    loginState: { busy: false, buttonText: "Login / Connect", disabled: false, error: null, modalOpen: false, statusAnnouncement: "Wallet connected." },
    embeddedWalletAddress: "0x1111111111111111111111111111111111111111",
    embeddedWalletSyncing: false,
    embeddedAddressCopied: false,
    onCopyEmbeddedAddress: () => undefined,
    onLogin: () => undefined,
    onLogout: () => undefined,
    onOpenWalletSettings: () => undefined,
    privyEthBalance: "0.0000",
    privyEthBalanceStatus: { ...READY_BALANCE_STATUS, stale: true, updatedAt: 1_700_000_000_000 },
    privyTokenBalance: "0.00",
    privyTokenBalanceStatus: { ...READY_BALANCE_STATUS, error: true },
  }));
  assert.match(staleErrorHeaderWalletHtml, /data-balance-state="stale"[^>]*title="ETH balance stale; showing last known 0\.0000"/);
  assert.match(staleErrorHeaderWalletHtml, />0\.0000<span[^>]*> ETH<\/span><span[^>]*>Stale<\/span>/);
  assert.match(staleErrorHeaderWalletHtml, /data-balance-state="error"[^>]*title="LINEA balance RPC error; showing last known 0\.00"/);
  assert.match(staleErrorHeaderWalletHtml, />0\.00<span[^>]*> LINEA<\/span><span[^>]*>RPC error<\/span>/);
  assert.match(staleErrorHeaderWalletHtml, /Last updated: ETH 22:13 UTC/);
  const validReplacementHash = `0x${"a".repeat(64)}`;
  const blockedStatus = {
    latestNonce: 7,
    pendingNonce: 9,
    nonceGap: 2,
    blockedNonce: 7,
    updatedAt: 1_700_000_000_000,
  };
  const pendingInputs = [
    {
      pendingTransactionStatus: null,
      isRefreshingPendingTx: false,
      isCancellingPendingTx: false,
      replacementHash: "",
    },
    {
      pendingTransactionStatus: { ...blockedStatus, pendingNonce: 7, nonceGap: 0, blockedNonce: null },
      isRefreshingPendingTx: false,
      isCancellingPendingTx: false,
      replacementHash: validReplacementHash,
    },
    {
      pendingTransactionStatus: blockedStatus,
      isRefreshingPendingTx: false,
      isCancellingPendingTx: false,
      replacementHash: `  ${validReplacementHash}  `,
    },
    {
      pendingTransactionStatus: blockedStatus,
      isRefreshingPendingTx: true,
      isCancellingPendingTx: false,
      replacementHash: validReplacementHash,
      busyAction: "nonce-check",
    },
    {
      pendingTransactionStatus: blockedStatus,
      isRefreshingPendingTx: true,
      isCancellingPendingTx: false,
      replacementHash: validReplacementHash,
      busyAction: "replacement",
    },
  ];
  for (const input of pendingInputs) {
    assertPendingPresentation(
      input,
      pendingTxPanel.getPendingTransactionPanelPresentation(input),
    );
  }
  assert.equal(pendingTxPanel.isExactWalletTransactionHash(validReplacementHash), true);
  assert.equal(pendingTxPanel.isExactWalletTransactionHash(` ${validReplacementHash} `), true);
  assert.equal(pendingTxPanel.isExactWalletTransactionHash(`0x${"a".repeat(63)}`), false);
  assert.equal(pendingTxPanel.isExactWalletTransactionHash(`0x${"g".repeat(64)}`), false);
  assert.equal(
    pendingTxPanel.normalizeWalletTransactionHashInput(`  ${validReplacementHash}  `),
    validReplacementHash,
    "pasted whitespace must be normalized before the 66-character UI clamp",
  );
  assert.equal(
    pendingTxPanel.isExactWalletTransactionHash(
      pendingTxPanel.normalizeWalletTransactionHashInput(`  ${validReplacementHash}  `),
    ),
    true,
    "a padded exact replacement hash accepted by the model must stay reachable through the controlled input",
  );
  assert.equal(
    pendingTxPanel.normalizeWalletTransactionHashInput(`${validReplacementHash}ffff`),
    validReplacementHash,
    "replacement hash input must remain bounded to one exact transaction hash",
  );

  const blockedPanelHtml = renderToStaticMarkup(React.createElement(
    pendingTxPanel.WalletSettingsPendingTxPanel,
    {
      pendingTransactionStatus: blockedStatus,
      isRefreshingPendingTx: false,
      isCancellingPendingTx: false,
      onRefreshPendingTx: () => undefined,
      onCancelPendingTx: () => undefined,
    },
  ));
  assert.match(blockedPanelHtml, /data-pending-transaction-state="blocked"/);
  assert.match(blockedPanelHtml, /Stuck pending transaction detected\. Nonce gap: 2\. Oldest blocked nonce: 7\./);
  assert.match(
    blockedPanelHtml,
    /Two RPCs must prove the same sender, nonce, destination, value, calldata, and transaction type before migration\. Finality is still required before the block can be released\./,
  );
  assert.match(blockedPanelHtml, /<button[^>]*disabled=""[^>]*aria-label="Verify exact wallet transfer replacement hash"/);
  assert.match(blockedPanelHtml, /aria-label="Replace the oldest stuck nonce with a 0 ETH self-transaction"/);

  const busyPanelHtml = renderToStaticMarkup(React.createElement(
    pendingTxPanel.WalletSettingsPendingTxPanel,
    {
      pendingTransactionStatus: blockedStatus,
      isRefreshingPendingTx: true,
      isCancellingPendingTx: false,
      onRefreshPendingTx: () => undefined,
      onCancelPendingTx: () => undefined,
    },
  ));
  assert.match(busyPanelHtml, /data-pending-transaction-state="blocked"/);
  assert.match(busyPanelHtml, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*aria-busy="true"/);
  assert.equal((busyPanelHtml.match(/disabled=""/g) ?? []).length, 3);
  assert.match(busyPanelHtml, /aria-label="Checking latest and pending nonces for the Privy wallet"/);

  for (const action of ["nonce-check", "replacement"]) {
    const transitions = [];
    let receivedHash = "not-called";
    let releaseRefresh;
    const refreshPromise = new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    const run = pendingTxPanel.runPendingTransactionRefreshAction({
      action,
      replacementHash: `  ${validReplacementHash}  `,
      onRefreshPendingTx: (hash) => {
        receivedHash = hash;
        return refreshPromise;
      },
      onBusyActionChange: (nextAction) => transitions.push(nextAction),
    });
    assert.deepEqual(transitions, [action], "initiating action must be retained while its callback is pending");
    assert.equal(receivedHash, action === "replacement" ? validReplacementHash : undefined);
    const livePresentation = pendingTxPanel.getPendingTransactionPanelPresentation({
      ...pendingInputs[2],
      isRefreshingPendingTx: true,
      busyAction: transitions.at(-1),
    });
    assertPendingPresentation(
      { ...pendingInputs[2], isRefreshingPendingTx: true, busyAction: action },
      livePresentation,
    );
    assert.equal(livePresentation.checkDisabled, true);
    assert.equal(livePresentation.clearDisabled, true);
    assert.equal(livePresentation.replacementDisabled, true);
    assert.ok(run instanceof Promise, "an async refresh callback must expose completion to the action lifecycle");
    releaseRefresh();
  }
  for (const action of ["nonce-check", "replacement"]) {
    const transitions = [];
    pendingTxPanel.runPendingTransactionRefreshAction({
      action,
      replacementHash: validReplacementHash,
      onRefreshPendingTx: () => undefined,
      onBusyActionChange: (nextAction) => transitions.push(nextAction),
    });
    assert.deepEqual(
      transitions,
      [action, null],
      "a synchronously completed refresh callback must clear its exact initiating action",
    );
  }

  const correctBlocked = pendingTxPanel.getPendingTransactionPanelPresentation(pendingInputs[2]);
  for (const mutant of [
    { ...correctBlocked, state: "clear" },
    { ...correctBlocked, clearDisabled: true },
    { ...correctBlocked, replacementDisabled: true },
  ]) {
    assert.throws(
      () => assertPendingPresentation(pendingInputs[2], mutant),
      undefined,
      "pending transaction presentation invariant must reject blocked/manual-reconcile mutants",
    );
  }
  const correctBusy = pendingTxPanel.getPendingTransactionPanelPresentation(pendingInputs[3]);
  assert.throws(
    () => assertPendingPresentation(pendingInputs[3], { ...correctBusy, checkDisabled: false }),
    undefined,
    "pending transaction presentation invariant must reject overlapping-action mutants",
  );
  const correctReplacementBusy = pendingTxPanel.getPendingTransactionPanelPresentation(pendingInputs[4]);
  for (const mutant of [
    { ...correctReplacementBusy, replacementButtonText: "Verify Replacement" },
    { ...correctReplacementBusy, busyAnnouncement: "Checking latest and pending nonces." },
    { ...correctReplacementBusy, replacementDisabled: false },
  ]) {
    assert.throws(
      () => assertPendingPresentation(pendingInputs[4], mutant),
      undefined,
      "replacement verification presentation must reject ambiguous or enabled-action mutants",
    );
  }
  const emptyPoolChartHtml = renderToStaticMarkup(React.createElement(headerPoolChart.HeaderPoolChart, {
    linePath: "",
    muted: false,
    onToggleMute: () => undefined,
    realTotalStaked: 0,
    rolloverAmount: 0,
  }));
  assert.match(emptyPoolChartHtml, /data-testid="header-pool-chart-visual"[^>]*data-empty-pool="true"[^>]*aria-label="Pool chart empty state"/);
  const emptyPoolLine = emptyPoolChartHtml.match(/<path\b[^>]*data-testid="header-pool-chart-line"[^>]*\bd="([^"]+)"/);
  assert.ok(emptyPoolLine?.[1], "empty pool must still render a visible chart line for browser smoke");
  const activePoolChartHtml = renderToStaticMarkup(React.createElement(headerPoolChart.HeaderPoolChart, {
    hydrated: true,
    linePath: "M 1,50 L 99,40",
    muted: true,
    onToggleMute: () => undefined,
    realTotalStaked: 2.5,
    rolloverAmount: 0,
  }));
  assert.match(activePoolChartHtml, /data-testid="header-pool-chart-visual"[^>]*data-empty-pool="false"[^>]*aria-label="Pool activity chart"/);
  assert.match(activePoolChartHtml, /data-testid="header-pool-chart-line"[^>]*d="M 1,50 L 99,40"/);
}
