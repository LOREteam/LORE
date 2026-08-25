import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deriveAutoMinerAction,
  deriveManualMiningAction,
  deriveWalletCta,
} from "../app/components/BetPanel";
import {
  formatExactMobileBetTotal,
  HubSidePanel,
  summarizeMobileTileSelection,
} from "../app/components/HubSidePanel";
import { createWalletSetupGuard, runWalletSetupAttempt } from "../app/lib/walletSetup";

assert.equal(
  formatExactMobileBetTotal("0.123456789123456789", 25),
  "3.086419728086419725",
  "mobile total must multiply the full 18-decimal amount without float rounding",
);
assert.equal(
  formatExactMobileBetTotal("9007199254740993.000000000000000001", 3),
  "27021597764222979.000000000000000003",
  "mobile total must stay exact above Number.MAX_SAFE_INTEGER",
);
assert.equal(formatExactMobileBetTotal("1,25", 4), "5", "localized decimal input must use the canonical normalizer");
assert.equal(formatExactMobileBetTotal("1e3", 2), null, "exponential notation must fail closed");
assert.equal(formatExactMobileBetTotal("0.0000000000000000001", 2), null, "precision overflow must fail closed");
assert.equal(formatExactMobileBetTotal("1", 26), null, "out-of-grid selection counts must fail closed");

assert.deepEqual(
  summarizeMobileTileSelection([25, 3, 3, 1, 12, 0, 26]),
  {
    compactLabel: "#1, #3, #12, #25",
    count: 4,
    fullLabel: "Selected tiles 1, 3, 12, 25",
  },
  "tile summary must be sorted, unique, and grid-bounded",
);
assert.deepEqual(
  summarizeMobileTileSelection([1, 2, 3, 4, 5, 6]),
  {
    compactLabel: "#1, #2, #3, #4 +2",
    count: 6,
    fullLabel: "Selected tiles 1, 2, 3, 4, 5, 6",
  },
  "long tile lists must retain the exact count and accessible full list",
);
assert.equal(summarizeMobileTileSelection([]).fullLabel, "No tiles selected");

const manualReady = deriveManualMiningAction({
  coldBootDefaults: false,
  isDisabled: false,
  isPending: false,
  liveStateReady: true,
  readOnlyReason: null,
  selectedTilesCount: 3,
  walletConnected: true,
});
assert.deepEqual(manualReady, { disabled: false, label: "BET ON 3 TILES", variant: "primary" });
assert.deepEqual(
  deriveManualMiningAction({
    coldBootDefaults: false,
    isDisabled: true,
    isPending: false,
    liveStateReady: false,
    readOnlyReason: null,
    selectedTilesCount: 0,
    walletConnected: false,
  }),
  { disabled: false, label: "LOGIN TO BET", variant: "primary" },
  "guest manual CTA must be an active login action, not a disabled form button",
);
assert.deepEqual(
  deriveManualMiningAction({
    coldBootDefaults: false,
    isDisabled: false,
    isPending: false,
    liveStateReady: true,
    readOnlyReason: null,
    selectedTilesCount: 3,
    walletAuthenticated: true,
    walletConnected: false,
  }),
  { disabled: false, label: "CREATE WALLET", variant: "primary" },
  "an authenticated user without an embedded wallet must enter wallet setup instead of reopening login",
);
assert.deepEqual(
  deriveManualMiningAction({
    coldBootDefaults: false,
    isDisabled: false,
    isPending: false,
    liveStateReady: true,
    readOnlyReason: null,
    selectedTilesCount: 3,
    walletAuthenticated: true,
    walletConnected: false,
    embeddedWalletSyncing: true,
  }),
  { disabled: true, label: "SYNCING...", variant: "pending" },
  "wallet setup must wait while Privy wallet state is syncing",
);
assert.deepEqual(
  deriveManualMiningAction({
    coldBootDefaults: false,
    isDisabled: true,
    isPending: true,
    liveStateReady: true,
    readOnlyReason: null,
    selectedTilesCount: 3,
    walletConnected: true,
  }),
  { disabled: true, label: "BET PENDING", variant: "pending" },
  "manual pending state must not look actionable",
);

const autoBase = {
  autoMinePhase: "idle" as const,
  coldBootDefaults: false,
  isAutoMining: false,
  isDisabled: false,
  isPending: false,
  liveStateReady: true,
  lowEthForGas: false,
  readOnlyReason: null,
  walletConnected: true,
};
assert.deepEqual(
  deriveAutoMinerAction(autoBase),
  { disabled: false, label: "START BOT", variant: "primary" },
);
assert.deepEqual(
  deriveAutoMinerAction({ ...autoBase, walletConnected: false, isDisabled: true, liveStateReady: false }),
  { disabled: false, label: "LOGIN TO START", variant: "primary" },
  "guest Auto-Miner CTA must open login instead of remaining disabled",
);
assert.deepEqual(
  deriveAutoMinerAction({ ...autoBase, walletAuthenticated: true, walletConnected: false }),
  { disabled: false, label: "CREATE WALLET", variant: "primary" },
  "authenticated Auto-Miner CTA must create an embedded wallet instead of reopening login",
);
assert.equal(deriveWalletCta({ walletAuthenticated: false, walletConnected: false }), "login");
assert.equal(deriveWalletCta({ walletAuthenticated: true, walletConnected: false }), "create");
assert.equal(deriveWalletCta({ walletAuthenticated: true, walletConnected: false, embeddedWalletSyncing: true }), "syncing");
assert.equal(deriveWalletCta({ walletAuthenticated: true, walletConnected: false, walletSetupCreating: true }), "creating");
assert.equal(deriveWalletCta({ walletAuthenticated: true, walletConnected: true, embeddedWalletSyncing: true }), "ready");
assert.deepEqual(
  deriveAutoMinerAction({ ...autoBase, isDisabled: true, isPending: true }),
  { disabled: true, label: "TX PENDING", variant: "pending" },
  "idle Auto-Miner must expose pending instead of a second start action",
);
assert.deepEqual(
  deriveAutoMinerAction({ ...autoBase, isAutoMining: true }),
  { disabled: false, label: "STOP BOT", variant: "danger" },
  "active Auto-Miner must keep the guarded stop action available",
);
assert.deepEqual(
  deriveAutoMinerAction({ ...autoBase, autoMinePhase: "retry-wait", isDisabled: true }),
  { disabled: true, label: "RESUME PENDING", variant: "pending" },
);

const baseManualBetForm = {
  betAmount: "1.0",
  setBetAmount: () => undefined,
  totalBet: 3,
  totalBetDisplay: "3.00",
  betAmountError: null,
  balance: 10,
  balanceDisplay: "10.00",
  lineaDeficit: 0,
  lineaDeficitDisplay: "0.00",
  manualInsufficient: false,
  disabledReason: null,
  isDisabled: false,
};
const baseSidePanelProps: React.ComponentProps<typeof HubSidePanel> = {
  chatOpen: false,
  coldBootDefaults: false,
  formattedBalance: "100",
  walletAuthenticated: true,
  walletConnected: true,
  embeddedWalletSyncing: false,
  walletSetupCreating: false,
  walletSetupError: null,
  onCreateEmbeddedWallet: async () => undefined,
  liveStateReady: true,
  readOnlyReason: null,
  gridSelectedTiles: [1, 2, 3],
  selectedTilesCount: 3,
  feeEstimate: null,
  feeEstimateUnavailable: false,
  isPending: false,
  isRevealing: false,
  isAnalyzing: false,
  isAutoMining: false,
  manualBetForm: baseManualBetForm,
  handleManualMineWithGuard: async () => undefined,
  onQuickPickTiles: () => undefined,
  autoMinePhase: "idle",
  autoMineProgress: null,
  runningParams: null,
  lowEthBalance: false,
  handleAutoMineWithGuard: async () => undefined,
};
const renderSidePanel = (overrides: Partial<React.ComponentProps<typeof HubSidePanel>> = {}) =>
  renderToStaticMarkup(React.createElement(HubSidePanel, { ...baseSidePanelProps, ...overrides }));
const getOpeningTag = (markup: string, attribute: string) => {
  const attributeIndex = markup.indexOf(attribute);
  if (attributeIndex < 0) return "";
  const openingIndex = markup.lastIndexOf("<", attributeIndex);
  const closingIndex = markup.indexOf(">", attributeIndex);
  return openingIndex >= 0 && closingIndex >= 0 ? markup.slice(openingIndex, closingIndex + 1) : "";
};
const getClassName = (openingTag: string) => openingTag.match(/class="([^"]*)"/)?.[1] ?? "";

const mobileActionMarkup = renderSidePanel();
const mobileManualActionTag = getOpeningTag(mobileActionMarkup, 'data-testid="mobile-manual-bet-action"');
const mobileAutoActionTag = getOpeningTag(mobileActionMarkup, 'data-testid="mobile-auto-miner-action"');
const dockedManualActionTag = getOpeningTag(mobileActionMarkup, 'data-testid="manual-bet-action"');
const dockedAutoActionTag = getOpeningTag(mobileActionMarkup, 'data-testid="auto-miner-action"');
assert.notEqual(mobileManualActionTag, "", "the rendered mobile manual action must exist");
assert.notEqual(mobileAutoActionTag, "", "the rendered mobile Auto-Miner action must exist");
assert.match(getClassName(mobileManualActionTag), /(?:^|\s)h-11(?:\s|$)/, "the mobile manual action must render a 44px touch target");
assert.match(getClassName(mobileAutoActionTag), /(?:^|\s)h-11(?:\s|$)/, "the mobile Auto-Miner action must render a 44px touch target");
assert.match(
  getClassName(dockedManualActionTag),
  /(?:^|\s)max-\[899px\]:hidden(?:\s|$)/,
  "the rendered in-panel manual action must be hidden while the mobile dock owns the primary CTA",
);
assert.match(
  getClassName(dockedAutoActionTag),
  /(?:^|\s)max-\[899px\]:hidden(?:\s|$)/,
  "the rendered in-panel Auto-Miner action must be hidden while the mobile dock owns the primary CTA",
);

const manualErrorMarkup = renderSidePanel({
  manualBetForm: {
    ...baseManualBetForm,
    betAmount: "0",
    betAmountError: "Amount must be greater than zero",
    disabledReason: "Amount must be greater than zero",
    isDisabled: true,
  },
});
const invalidAmountInputTag = getOpeningTag(manualErrorMarkup, 'id="mobile-bet-amount-per-tile"');
assert.match(invalidAmountInputTag, /aria-describedby="mobile-bet-amount-error"/, "an invalid mobile amount must describe its rendered validation message");
assert.doesNotMatch(
  getOpeningTag(mobileActionMarkup, 'id="mobile-bet-amount-per-tile"'),
  /aria-describedby=/,
  "a valid mobile amount must not retain a validation-message description",
);

const walletCreatingMarkup = renderSidePanel({ walletConnected: false, walletSetupCreating: true });
const walletCreatingStatusTag = getOpeningTag(walletCreatingMarkup, 'id="mobile-wallet-setup-status"');
assert.match(walletCreatingStatusTag, /role="status"/, "wallet creation must render a status live region");
assert.match(walletCreatingStatusTag, /aria-live="polite"/, "wallet creation updates must be announced politely");
assert.match(walletCreatingStatusTag, /aria-busy="true"/, "the rendered wallet status must remain busy during creation");
assert.match(walletCreatingMarkup, />Creating wallet\.\.\.<\/span>/, "the wallet status must expose the creating state text");
const walletErrorMarkup = renderSidePanel({ walletConnected: false, walletSetupError: "Wallet setup failed" });
assert.match(
  getOpeningTag(walletErrorMarkup, 'id="mobile-wallet-setup-status"'),
  /role="alert"/,
  "a rendered wallet setup failure must promote the separate live region to an alert",
);
assert.match(walletErrorMarkup, />Wallet setup failed<\/span>/, "the separate wallet status must expose the failure text");

const chatOpenMarkup = renderSidePanel({ chatOpen: true });
assert.doesNotMatch(chatOpenMarkup, /data-testid="mobile-mining-action-bar"/, "chat must replace, not overlap, the rendered sticky action bar");

const sidePanelSource = readFileSync("app/components/HubSidePanel.tsx", "utf8");
const betPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
const hubSource = readFileSync("app/components/HubContent.tsx", "utf8");
const walletRuntimeSource = readFileSync("app/hooks/useLineaOreClientRuntime.ts", "utf8");
const gameplayStageClass = hubSource.match(/className="([^"]*gameplay-stage[^"]*)"/)?.[1] ?? "";

assert.equal(
  (sidePanelSource.match(/const autoMinerForm = useAutoMinerForm\(/g) ?? []).length,
  1,
  "manual rail and sticky bar must share one Auto-Miner form owner",
);
assert.doesNotMatch(
  betPanelSource,
  /useAutoMinerForm\(\{/,
  "AutoMinerPanel must consume the shared form instead of mounting a second hook",
);
assert.match(sidePanelSource, /actionInFlightRef\.current/, "manual and Auto-Miner callbacks must share an in-flight lock");
assert.match(sidePanelSource, /onMine=\{handleManualAction\}/);
assert.match(sidePanelSource, /onToggle=\{handleAutoAction\}/);
assert.match(sidePanelSource, /onManualAction=\{handleManualAction\}/);
assert.match(sidePanelSource, /onAutoAction=\{handleAutoAction\}/);
assert.match(sidePanelSource, /manualWalletCta === "login"[\s\S]*requestWalletLogin\(\)[\s\S]*manualWalletCta === "create"[\s\S]*onWalletSetup\(\)/, "mobile manual CTA must separate guest login from authenticated wallet setup");
assert.match(sidePanelSource, /autoWalletCta === "login"[\s\S]*requestWalletLogin\(\)[\s\S]*autoWalletCta === "create"[\s\S]*onWalletSetup\(\)/, "mobile Auto-Miner CTA must separate guest login from authenticated wallet setup");
assert.match(betPanelSource, /walletCta === "login"[\s\S]*requestWalletLogin\(\)[\s\S]*walletCta === "create"[\s\S]*onWalletSetup/, "desktop CTA must separate guest login from authenticated wallet setup");
assert.match(sidePanelSource, /handleWalletSetup[\s\S]*actionInFlightRef\.current[\s\S]*onCreateEmbeddedWallet\(\)/, "manual and Auto-Miner wallet setup must delegate to the shared duplicate-action guard");
assert.match(walletRuntimeSource, /walletSetupIdentityRef[\s\S]*!wallet\.authenticated \|\| identityChanged/, "wallet setup must invalidate its guard on logout or wallet identity change");
assert.match(sidePanelSource, /onCreateEmbeddedWallet: \(\) => Promise<void>/, "wallet setup must retain the async creation contract");
assert.match(sidePanelSource, /window\.visualViewport/);
assert.match(sidePanelSource, /env\(safe-area-inset-bottom\)/);
assert.match(
  gameplayStageClass,
  /min-\[900px\]:backdrop-blur-md/,
  "mobile gameplay must not create a backdrop-filter containing block around the fixed action dock",
);
assert.doesNotMatch(
  gameplayStageClass,
  /(?:^|\s)backdrop-blur-md(?:\s|$)/,
  "an unscoped mobile backdrop filter would move and clip the fixed action dock",
);
assert.doesNotMatch(hubSource, /MobileManualActionBar/, "the obsolete second mobile action implementation must be removed");

assert.deepEqual(
  deriveManualMiningAction({
    coldBootDefaults: false,
    isDisabled: false,
    isPending: false,
    liveStateReady: true,
    readOnlyReason: null,
    selectedTilesCount: 3,
    walletAuthenticated: true,
    walletConnected: false,
    walletSetupCreating: true,
  }),
  { disabled: true, label: "CREATING WALLET...", variant: "pending" },
  "desktop and mobile manual CTAs must expose a disabled creating state",
);
assert.deepEqual(
  deriveAutoMinerAction({ ...autoBase, walletAuthenticated: true, walletConnected: false, walletSetupCreating: true }),
  { disabled: true, label: "CREATING WALLET...", variant: "pending" },
  "desktop and mobile Auto-Miner CTAs must expose a disabled creating state",
);

const walletSetupBehaviorTest = (async () => {
  const states: string[] = [];
  const firstDeferred: { reject: (error: Error) => void } = { reject: () => { throw new Error("first rejection was not initialized"); } };
  const retryDeferred: { resolve: () => void } = { resolve: () => { throw new Error("retry resolution was not initialized"); } };
  const pendingFirst = new Promise<void>((_resolve, reject) => {
    firstDeferred.reject = reject;
  });
  const pendingRetry = new Promise<void>((resolve) => {
    retryDeferred.resolve = resolve;
  });
  let createCalls = 0;
  const sharedGuard = createWalletSetupGuard({
    onCreateEmbeddedWallet: () => {
      createCalls += 1;
      if (createCalls === 1) return pendingFirst;
      if (createCalls === 2) return pendingRetry;
      if (createCalls === 3) return Promise.reject(new Error("synthetic Privy failure"));
      return Promise.resolve();
    },
    onStateChange: (state) => states.push(state),
  });

  const oldUserAttempt = sharedGuard.run();
  assert.equal(createCalls, 1, "wallet creation must start exactly once while the CTA is disabled");
  sharedGuard.reset(); // User logs out; this invalidates the old user attempt.
  const newUserRetryAttempt = sharedGuard.run();
  assert.equal(createCalls, 2, "logout reset must permit a new user wallet setup attempt");
  firstDeferred.reject(new Error("stale Privy failure"));
  await oldUserAttempt;
  assert.deepEqual(states, ["creating", "idle", "creating"], "stale old-user settlement after logout must not unlock or overwrite the new-user retry state");
  retryDeferred.resolve();
  await newUserRetryAttempt;
  assert.equal(states.at(-1), "creating", "a successful attempt remains locked until wallet sync confirms it");
  sharedGuard.reset();
  await sharedGuard.run();
  assert.equal(states.at(-1), "error", "current wallet creation rejection must become a retryable error state");
  await sharedGuard.run();
  assert.equal(createCalls, 4, "wallet setup error must permit a later retry");
  sharedGuard.reset();
  assert.equal(states.at(-1), "idle", "wallet connection reset must release the shared setup lock");
  assert.equal(await runWalletSetupAttempt(() => Promise.resolve()), "complete", "wallet setup helper must preserve successful completion");
})();
void walletSetupBehaviorTest.then(
  () => console.log(JSON.stringify({
  ok: true,
  exactDecimalTotal: true,
  sharedAutoMinerForm: true,
  sharedActionLock: true,
  touchTargetsPx: 44,
  visualViewportAware: true,
  walletSetupCta: true,
})),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
