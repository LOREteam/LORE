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

const walletTransferRow = walletTransferRowModule.default ?? walletTransferRowModule;
const walletTransferPanels = walletTransferPanelsModule.default ?? walletTransferPanelsModule;
const pageWalletOverview = pageWalletOverviewModule.default ?? pageWalletOverviewModule;
const normalizeCachedPrivyBalances = pageWalletOverview.normalizeCachedPrivyBalances;
const pendingTxPanel = pendingTxPanelModule.default ?? pendingTxPanelModule;
const headerPoolChart = headerPoolChartModule.default ?? headerPoolChartModule;
const headerWalletCard = headerWalletCardModule.default ?? headerWalletCardModule;
const sectionBuilders = sectionBuildersModule.default ?? sectionBuildersModule;

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
  const walletSettingsModalSource = readFileSync("app/components/WalletSettingsModal.tsx", "utf8");
  const betPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  assert.match(
    betPanelSource,
    /className="console-input lore-nums h-11 px-3 text-base font-black"/,
    "manual bet amount input must use the shared numeric font class and 44px touch height",
  );
  const hubSidePanelSourceForTypography = readFileSync("app/components/HubSidePanel.tsx", "utf8");
  assert.match(
    hubSidePanelSourceForTypography,
    /value=\{manualBetForm\.betAmount\}[\s\S]*lore-nums h-11 w-full[\s\S]*tabular-nums/,
    "mobile compact manual bet amount input must use the shared numeric font class",
  );
  assert.match(
    hubSidePanelSourceForTypography,
    /aria-label="Exact total stake"[\s\S]*lore-nums[\s\S]*tabular-nums[\s\S]*\{exactTotal \?\? "Unavailable"\} LINEA/,
    "mobile compact manual bet total must use the shared numeric font class",
  );
  assert.match(
    betPanelSource,
    /SmallInput[\s\S]*console-input lore-nums/,
    "auto-miner numeric inputs must keep the shared numeric font class",
  );
  assert.match(
    betPanelSource,
    /data-testid="manual-bet-action"/,
    "manual bet primary action must expose a stable smoke-test selector",
  );
  assert.match(
    betPanelSource,
    /manualButtonDescriptionId[\s\S]*manual-bet-readonly-reason[\s\S]*manual-bet-insufficient-reason[\s\S]*bet-amount-per-tile-error[\s\S]*manual-bet-status[\s\S]*manual-bet-disabled-reason[\s\S]*aria-describedby=\{manualButtonDescriptionId\}/,
    "manual bet primary action must only reference a visible disabled/status reason",
  );
  assert.match(
    betPanelSource,
    /Bet network fee[\s\S]*feeEstimateUnavailable[\s\S]*Unavailable/,
    "desktop manual bet must show the live fee estimate or an explicit unavailable state",
  );
  assert.match(
    betPanelSource,
    /data-testid="auto-miner-action"/,
    "auto-miner primary action must expose a stable smoke-test selector",
  );
  assert.match(
    betPanelSource,
    /top up \{lineaDeficitDisplay\} LINEA/,
    "auto-miner insufficient-balance copy must show the exact LINEA top-up deficit",
  );
  assert.match(
    betPanelSource,
    /aria-describedby=\{autoAction\.disabled && disabledReason && !isAutoMining \? "auto-miner-disabled-reason" : undefined\}/,
    "auto-miner disabled reason must be associated with the disabled primary action",
  );
  assert.match(
    betPanelSource,
    /manualAnnouncement[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*\{manualAnnouncement\}/,
    "manual bet state transitions must be announced without relying on visible text changes",
  );
  assert.match(
    betPanelSource,
    /autoMinerAnnouncement[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*\{autoMinerAnnouncement\}/,
    "auto-miner phase transitions must be announced without reading every progress update",
  );
  assert.match(
    betPanelSource,
    /showAutoMineProgress[\s\S]*autoMinePhase === "retry-wait"[\s\S]*autoMinePhase === "session-expired"/,
    "auto-miner recovery states must keep the progress message visible after the active loop pauses",
  );
  assert.match(
    betPanelSource,
    /showAutoMineProgress && phaseProgressText/,
    "auto-miner progress card must use the shared recovery progress visibility guard",
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
  const walletTransferPanelsSource = readFileSync("app/components/wallet/WalletSettingsTransferPanels.tsx", "utf8");
  assert.match(
    walletTransferPanelsSource,
    /lore-nums[\s\S]*totalIn/,
    "wallet transfer summary totals must use the shared numeric font class",
  );
  assert.match(
    walletTransferPanelsSource,
    /walletTransfers\.totalInDisplay[\s\S]*walletTransfers\.totalOutDisplay/,
    "wallet transfer summary totals must render bigint-safe display strings",
  );
  assert.doesNotMatch(
    walletTransferPanelsSource,
    /walletTransfers\.(?:totalIn|totalOut)\.toFixed\(2\)/,
    "wallet transfer summary totals must not format numeric compatibility fields for display",
  );
  assert.match(
    walletTransferPanelsSource,
    /transferHistoryLoadLabel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-label=\{transferHistoryLoadLabel\}[\s\S]*title=\{transferHistoryLoadLabel\}/,
    "wallet transfer history load action must expose a state-aware label and polite loading status",
  );
  assert.match(
    walletTransferPanelsSource,
    /role="list"[\s\S]*aria-label="LINEA transfer history"[\s\S]*explorerLabel[\s\S]*role="listitem"[\s\S]*aria-label=\{explorerLabel\}[\s\S]*title=\{explorerLabel\}/,
    "wallet transfer history rows must expose list semantics and clear Lineascan link labels",
  );
  assert.match(
    walletTransferPanelsSource,
    /walletTransfers\.statusMessage[\s\S]*dataStatus === "error"[\s\S]*Try again[\s\S]*No verified LINEA transfers were found/,
    "wallet transfer history must distinguish unavailable RPC data from an empty verified history",
  );
  assert.deepEqual(
    normalizeCachedPrivyBalances(undefined),
    { token: null, eth: null },
    "missing cached wallet balances must remain unknown instead of becoming zero",
  );
  assert.deepEqual(
    normalizeCachedPrivyBalances({ token: "not-a-number", eth: "Infinity" }),
    { token: null, eth: null },
    "invalid cached wallet balances must remain unknown instead of becoming zero",
  );
  assert.deepEqual(
    normalizeCachedPrivyBalances({ token: "0", eth: "0" }),
    { token: "0.00", eth: "0.0000" },
    "a verified literal zero must remain distinguishable from an unavailable balance",
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
    pageWalletOverview.isHeaderLineaBalanceLoading(true, null, "0.00"),
    false,
    "a cached verified zero must remain visible while a refresh runs",
  );
  assert.equal(
    pageWalletOverview.isHeaderLineaBalanceLoading(true, "0.00", null),
    false,
    "a current verified zero must not be rendered as loading",
  );
  const unavailableTransferSummary = {
    transfers: [],
    totalIn: 0,
    totalOut: 0,
    totalInDisplay: "0.00",
    totalOutDisplay: "0.00",
    dataStatus: "error",
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
      walletTransfers: { ...unavailableTransferSummary, dataStatus: "live", statusMessage: null },
    },
  ));
  assert.match(verifiedZeroTransferPanelHtml, /LINEA Balance: <span[^>]*>0\.00 LINEA<\/span>/);
  assert.match(verifiedZeroTransferPanelHtml, /ETH Balance: <span[^>]*>0\.0000 ETH<\/span>/);
  assert.match(verifiedZeroTransferPanelHtml, /Deposited<\/div>[\s\S]*?0\.00/);
  assert.match(verifiedZeroTransferPanelHtml, /Withdrawn<\/div>[\s\S]*?0\.00/);
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
    headerEthLoading: false,
    headerLineaBalance: null,
    headerLineaLoading: false,
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
    headerWalletCard.getHeaderWalletBalancePresentation("LINEA", "—", false),
    { state: "unavailable", text: "Unavailable", suffix: "LINEA", label: "LINEA balance unavailable" },
  );
  assert.deepEqual(
    headerWalletCard.getHeaderWalletBalancePresentation("LINEA", "0.00", false),
    { state: "ready", text: "0.00", suffix: "LINEA", label: "LINEA balance 0.00" },
  );
  assert.equal(headerWalletCard.getHeaderWalletBalancePresentation("ETH", "—", true).state, "loading");
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
    privyEthBalanceLoading: false,
    privyTokenBalance: "—",
    privyTokenBalanceLoading: false,
  }));
  assert.match(unavailableHeaderWalletHtml, /aria-label="ETH balance unavailable"[^>]*data-balance-state="unavailable"/);
  assert.match(unavailableHeaderWalletHtml, /Unavailable<span[^>]*> ETH<\/span>/);
  assert.match(unavailableHeaderWalletHtml, /aria-label="LINEA balance unavailable"[^>]*data-balance-state="unavailable"/);
  assert.match(unavailableHeaderWalletHtml, /Unavailable<span[^>]*> LINEA<\/span>/);
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
  assert.match(
    walletSettingsModalSource,
    /aria-pressed=\{activeSection === s\.id\}/,
    "mobile wallet settings sections must expose their selected state",
  );
  assert.match(
    walletSettingsModalSource,
    /min-h-11[^"]*focus-visible:ring-2/,
    "mobile wallet settings sections must keep a 44px touch target and visible keyboard focus",
  );
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
