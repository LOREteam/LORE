import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveAutoMinerAction,
  deriveManualMiningAction,
  deriveWalletCta,
} from "../app/components/BetPanel";
import {
  formatExactMobileBetTotal,
  runWalletSetupAttempt,
  summarizeMobileTileSelection,
} from "../app/components/HubSidePanel";

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

const sidePanelSource = readFileSync("app/components/HubSidePanel.tsx", "utf8");
const betPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
const hubSource = readFileSync("app/components/HubContent.tsx", "utf8");
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
assert.match(sidePanelSource, /handleWalletSetup[\s\S]*actionInFlightRef\.current[\s\S]*runWalletSetupAttempt\(onCreateEmbeddedWallet\)/, "manual and Auto-Miner wallet setup must share a caught duplicate-action guard");
assert.match(sidePanelSource, /onCreateEmbeddedWallet: \(\) => Promise<void>/, "wallet setup must retain the async creation contract");
assert.match(sidePanelSource, /aria-describedby=\{manualBetForm\.betAmountError \? "mobile-bet-amount-error" : undefined\}/, "the mobile amount input must describe only its validation message");
assert.match(sidePanelSource, /id="mobile-wallet-setup-status"[\s\S]*role=\{walletSetupError \? "alert" : "status"\}[\s\S]*aria-live="polite"[\s\S]*aria-busy=\{walletSetupCreating \|\| undefined\}/, "wallet setup creation must expose a separate live busy status");
assert.equal(
  (sidePanelSource.match(/mobileActionDocked/g) ?? []).length,
  2,
  "the mobile dock must replace both in-panel primary buttons instead of exposing duplicate mobile sends",
);
assert.match(betPanelSource, /mobileActionDocked && "max-\[899px\]:hidden"/);
assert.match(sidePanelSource, /data-testid="mobile-manual-bet-action"[\s\S]*?className="h-11/);
assert.match(sidePanelSource, /data-testid="mobile-auto-miner-action"[\s\S]*?className="h-11/);
assert.match(sidePanelSource, /window\.visualViewport/);
assert.match(sidePanelSource, /env\(safe-area-inset-bottom\)/);
assert.match(sidePanelSource, /if \(chatOpen\) return null;/, "chat must replace, not overlap, the sticky action bar");
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
let rejectWalletCreation: (error: Error) => void = () => { throw new Error("wallet creation rejection was not initialized"); };
const pendingWalletCreation = new Promise<void>((_resolve, reject) => {
  rejectWalletCreation = reject;
});
let createCalls = 0;
const pendingAttempt = runWalletSetupAttempt(() => {
  createCalls += 1;
  return pendingWalletCreation;
});
await Promise.resolve();
assert.equal(createCalls, 1, "wallet creation must start exactly once while the CTA is disabled");
let pendingSettled = false;
void pendingAttempt.then(() => { pendingSettled = true; });
await Promise.resolve();
assert.equal(pendingSettled, false, "wallet CTA must retain creating feedback while the wallet promise is deferred");
rejectWalletCreation(new Error("synthetic Privy failure"));
assert.equal(await pendingAttempt, "failed", "wallet creation rejection must be caught for a retryable error state");
assert.equal(await runWalletSetupAttempt(() => Promise.resolve()), "complete", "wallet creation must remain retryable after a handled rejection");
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
