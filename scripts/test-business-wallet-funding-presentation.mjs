import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as betPanelModule from "../app/components/BetPanel.tsx";
import * as uiButtonModule from "../app/components/ui/UiButton.tsx";
import * as walletSettingsPrivyPanelModule from "../app/components/wallet/WalletSettingsPrivyPanel.tsx";
import * as walletTransferRowModule from "../app/components/wallet/WalletTransferRow.tsx";
import * as autoMinerFormModule from "../app/hooks/useAutoMinerForm.ts";
import * as manualBetFormModule from "../app/hooks/useManualBetForm.ts";
import * as miningGuardsModule from "../app/hooks/useMiningGuards.ts";
import * as appConstantsModule from "../app/lib/constants.ts";

const betPanel = betPanelModule.default ?? betPanelModule;
const uiButton = uiButtonModule.default ?? uiButtonModule;
const walletSettingsPrivyPanel = walletSettingsPrivyPanelModule.default ?? walletSettingsPrivyPanelModule;
const walletTransferRow = walletTransferRowModule.default ?? walletTransferRowModule;

const autoMinerForm = autoMinerFormModule.default ?? autoMinerFormModule;
const manualBetForm = manualBetFormModule.default ?? manualBetFormModule;
const miningGuards = miningGuardsModule.default ?? miningGuardsModule;
const appConstants = appConstantsModule.default ?? appConstantsModule;
const MANUAL_BET_AMOUNT_KEY = `lineaore:manual-bet-amount:v2:${appConstants.APP_CHAIN_ID}:${appConstants.CONTRACT_ADDRESS.toLowerCase()}`;
const LEGACY_MANUAL_BET_AMOUNT_KEY = "lineaore:manual-bet-amount:v1";
const AUTO_MINER_INPUTS_KEY = `lineaore:auto-miner-inputs:v2:${appConstants.APP_CHAIN_ID}:${appConstants.CONTRACT_ADDRESS.toLowerCase()}`;
const LEGACY_AUTO_MINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";

function createManualBetStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  const operations = [];
  return {
    getItem(key) {
      operations.push(["get", key]);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      operations.push(["set", key, value]);
      values.set(key, value);
    },
    removeItem(key) {
      operations.push(["remove", key]);
      values.delete(key);
    },
    values,
    operations,
  };
}

function ManualBetFormProbe(props) {
  const state = manualBetForm.useManualBetForm(props);
  return React.createElement("output", {
    "data-balance": String(state.balance),
    "data-balance-display": state.balanceDisplay,
    "data-deficit": String(state.lineaDeficit),
    "data-deficit-display": state.lineaDeficitDisplay,
    "data-insufficient": String(state.manualInsufficient),
    "data-total": String(state.totalBet),
    "data-total-display": state.totalBetDisplay,
  }, state.disabledReason ?? "ready");
}

export function runWalletFundingPresentationTests() {
  const insufficientManualBetMarkup = renderToStaticMarkup(React.createElement(ManualBetFormProbe, {
    formattedBalance: "15.5",
    walletConnected: true,
    selectedTilesCount: 2,
    isPending: false,
    isRevealing: false,
    isAutoMining: false,
  }));
  assert.match(
    insufficientManualBetMarkup,
    /data-balance="15\.5" data-balance-display="15\.50" data-deficit="4\.5" data-deficit-display="4\.50" data-insufficient="true" data-total="20" data-total-display="20\.00">Insufficient LINEA balance/,
    "manual betting must expose the exact LINEA shortfall and canonical display values",
  );
  const fundedManualBetMarkup = renderToStaticMarkup(React.createElement(ManualBetFormProbe, {
    formattedBalance: "25",
    walletConnected: true,
    selectedTilesCount: 2,
    isPending: false,
    isRevealing: false,
    isAutoMining: false,
  }));
  assert.match(
    fundedManualBetMarkup,
    /data-balance="25" data-balance-display="25\.00" data-deficit="0" data-deficit-display="0\.00" data-insufficient="false" data-total="20" data-total-display="20\.00">ready/,
    "manual betting must clear the deficit when the wallet balance covers the total",
  );
  const restoreGateStorage = createManualBetStorage([[MANUAL_BET_AMOUNT_KEY, "12.5"]]);
  manualBetForm.persistManualBetAmountAfterRestore(restoreGateStorage, false, "10.0");
  assert.equal(
    restoreGateStorage.values.get(MANUAL_BET_AMOUNT_KEY),
    "12.5",
    "manual bet storage must not persist the default amount before restore completes",
  );
  manualBetForm.persistManualBetAmountAfterRestore(restoreGateStorage, true, "12.5");
  assert.equal(restoreGateStorage.values.get(MANUAL_BET_AMOUNT_KEY), "12.5");
  const currentWinsStorage = createManualBetStorage([
    [MANUAL_BET_AMOUNT_KEY, " 12.5 "],
    [LEGACY_MANUAL_BET_AMOUNT_KEY, "3.5"],
  ]);
  assert.equal(manualBetForm.restoreManualBetAmount(currentWinsStorage), "12.5");
  assert.equal(currentWinsStorage.values.get(LEGACY_MANUAL_BET_AMOUNT_KEY), "3.5");

  const invalidCurrentStorage = createManualBetStorage([
    [MANUAL_BET_AMOUNT_KEY, "1e3"],
    [LEGACY_MANUAL_BET_AMOUNT_KEY, "3.5"],
  ]);
  assert.equal(manualBetForm.restoreManualBetAmount(invalidCurrentStorage), null);
  assert.equal(invalidCurrentStorage.values.has(MANUAL_BET_AMOUNT_KEY), false);
  assert.equal(invalidCurrentStorage.values.get(LEGACY_MANUAL_BET_AMOUNT_KEY), "3.5");

  const legacyStorage = createManualBetStorage([[LEGACY_MANUAL_BET_AMOUNT_KEY, " 4.25 "]]);
  const restoredLegacyAmount = manualBetForm.restoreManualBetAmount(legacyStorage);
  assert.equal(restoredLegacyAmount, "4.25");
  assert.equal(legacyStorage.values.has(LEGACY_MANUAL_BET_AMOUNT_KEY), false);
  manualBetForm.persistManualBetAmount(legacyStorage, restoredLegacyAmount);
  assert.equal(legacyStorage.values.get(MANUAL_BET_AMOUNT_KEY), "4.25");

  const removalFailingLegacyStorage = {
    getItem(key) {
      return key === LEGACY_MANUAL_BET_AMOUNT_KEY ? " 2.5 " : null;
    },
    removeItem() {
      throw new Error("storage unavailable");
    },
  };
  assert.equal(manualBetForm.restoreManualBetAmount(removalFailingLegacyStorage), "2.5");

  const invalidLegacyStorage = createManualBetStorage([[LEGACY_MANUAL_BET_AMOUNT_KEY, "0"]]);
  assert.equal(manualBetForm.restoreManualBetAmount(invalidLegacyStorage), null);
  assert.equal(invalidLegacyStorage.values.has(LEGACY_MANUAL_BET_AMOUNT_KEY), false);
  assert.equal(manualBetForm.restoreManualBetAmount(createManualBetStorage()), null);

  const commaAmountStorage = createManualBetStorage([[MANUAL_BET_AMOUNT_KEY, " 7,5 "]]);
  assert.equal(manualBetForm.restoreManualBetAmount(commaAmountStorage), "7,5");

  const persistedStorage = createManualBetStorage();
  manualBetForm.persistManualBetAmount(persistedStorage, " 7,5 ");
  assert.equal(persistedStorage.values.get(MANUAL_BET_AMOUNT_KEY), " 7,5 ");
  manualBetForm.persistManualBetAmount(persistedStorage, "1.0000000000000000001");
  assert.equal(persistedStorage.values.has(MANUAL_BET_AMOUNT_KEY), false);

  const clearedKeys = [];
  const readFailingStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    removeItem(key) {
      clearedKeys.push(key);
    },
  };
  assert.equal(manualBetForm.restoreManualBetAmount(readFailingStorage), null);
  assert.deepEqual(clearedKeys, [MANUAL_BET_AMOUNT_KEY, LEGACY_MANUAL_BET_AMOUNT_KEY]);

  const setFailingStorage = createManualBetStorage([[MANUAL_BET_AMOUNT_KEY, "5"]]);
  setFailingStorage.setItem = () => {
    throw new Error("storage unavailable");
  };
  assert.doesNotThrow(() => manualBetForm.persistManualBetAmount(setFailingStorage, "2"));
  assert.equal(setFailingStorage.values.get(MANUAL_BET_AMOUNT_KEY), "5");
  const autoMinerReadKeys = [];
  assert.deepEqual(
    {
      restored: autoMinerForm.restoreAutoMinerInputs({
        getItem(key) {
          autoMinerReadKeys.push(key);
          return null;
        },
        removeItem() {},
      }),
      readKeys: autoMinerReadKeys,
    },
    {
      restored: null,
      readKeys: [AUTO_MINER_INPUTS_KEY, LEGACY_AUTO_MINER_INPUTS_KEY],
    },
    "auto-miner settings cache must read the chain-and-contract key before the legacy fallback",
  );
  const invalidAutoMinerStorage = createManualBetStorage([[AUTO_MINER_INPUTS_KEY, "stale"]]);
  autoMinerForm.persistAutoMinerInputs(invalidAutoMinerStorage, {
    betSize: "1e3",
    targets: 3,
    cycles: 5,
  });
  assert.equal(
    invalidAutoMinerStorage.values.has(AUTO_MINER_INPUTS_KEY),
    false,
    "auto-miner input cache must drop invalid in-progress bet sizes instead of restoring stale bad input",
  );
  assert.deepEqual(invalidAutoMinerStorage.operations, [["remove", AUTO_MINER_INPUTS_KEY]]);

  const validAutoMinerStorage = createManualBetStorage();
  autoMinerForm.persistAutoMinerInputs(validAutoMinerStorage, {
    betSize: " 7,5 ",
    targets: 4,
    cycles: 12,
  });
  assert.equal(
    validAutoMinerStorage.values.get(AUTO_MINER_INPUTS_KEY),
    JSON.stringify({ betSize: " 7,5 ", targets: 4, cycles: 12 }),
    "valid auto-miner inputs must persist under the chain-and-contract scoped key",
  );
  assert.deepEqual(validAutoMinerStorage.operations, [[
    "set",
    AUTO_MINER_INPUTS_KEY,
    JSON.stringify({ betSize: " 7,5 ", targets: 4, cycles: 12 }),
  ]], "auto-miner persistence must perform one exact scoped write without clearing another key");

  const failingAutoMinerStorage = createManualBetStorage([[AUTO_MINER_INPUTS_KEY, "previous"]]);
  failingAutoMinerStorage.setItem = (key, value) => {
    failingAutoMinerStorage.operations.push(["set", key, value]);
    throw new Error("storage unavailable");
  };
  assert.doesNotThrow(() => autoMinerForm.persistAutoMinerInputs(failingAutoMinerStorage, {
    betSize: "2",
    targets: 5,
    cycles: 25,
  }));
  assert.equal(
    failingAutoMinerStorage.values.get(AUTO_MINER_INPUTS_KEY),
    "previous",
    "storage write failures must preserve the previously stored auto-miner inputs",
  );
  assert.deepEqual(failingAutoMinerStorage.operations, [[
    "set",
    AUTO_MINER_INPUTS_KEY,
    JSON.stringify({ betSize: "2", targets: 5, cycles: 25 }),
  ]]);

  const unavailableStorageWindow = {};
  Object.defineProperty(unavailableStorageWindow, "localStorage", {
    get() {
      throw new Error("storage access denied");
    },
  });
  assert.doesNotThrow(() => autoMinerForm.persistAutoMinerInputsFromWindow(
    unavailableStorageWindow,
    { betSize: "2", targets: 3, cycles: 5 },
  ), "Auto-Miner persistence must tolerate a browser that denies access to localStorage itself");
  assert.match(
    readFileSync("scripts/smoke-browser.mjs", "utf8"),
    /lineaore:auto-miner-inputs:v2:\$\{SMOKE_CHAIN_ID\}:\$\{process\.env\.NEXT_PUBLIC_CONTRACT_ADDRESS\.toLowerCase\(\)\}/,
    "browser smoke must verify the same chain and contract scoped auto-miner cache key as runtime",
  );
  const insufficientAutoMinerMarkup = renderToStaticMarkup(React.createElement(betPanel.AutoMinerPanel, {
    form: {
      betSize: "1.005",
      setBetSize: () => undefined,
      targets: 1,
      cycles: 1,
      displayBetSize: "1.005",
      displayTargets: 1,
      displayCycles: 1,
      totalCost: 1.005,
      betSizeError: null,
      balance: 0,
      insufficientBalance: true,
      disabledReason: "Insufficient LINEA balance",
      isDisabled: true,
      handleTargetsChange: () => undefined,
      handleCyclesChange: () => undefined,
    },
    autoMinePhase: "idle",
    isAutoMining: false,
    isPending: false,
    isRevealing: false,
    walletAuthenticated: true,
    walletConnected: true,
    onToggle: () => undefined,
  }));
  assert.doesNotMatch(
    insufficientAutoMinerMarkup,
    /Need 1\.00, have 0\.00; top up 1\.00 LINEA/,
    "Auto-Miner funding copy must not round the exact 1.005 total down through direct number formatting",
  );
  assert.match(
    insufficientAutoMinerMarkup,
    /Need 1\.01, have 0\.00; top up 1\.01 LINEA/,
    "Auto-Miner top-up copy must render the canonical rounded total and exact visible deficit",
  );

  const privyPanelProps = {
    embeddedWalletAddress: "0x1111111111111111111111111111111111111111",
    externalWalletAddress: "0x2222222222222222222222222222222222222222",
    depositEthAmount: "",
    depositTokenAmount: "",
    isDepositingEth: false,
    isDepositingToken: false,
    onCopyEmbeddedAddress: () => undefined,
    onExportEmbeddedWallet: () => undefined,
    onCreateEmbeddedWallet: () => undefined,
    walletSetupCreating: false,
    walletSetupError: null,
    onDepositEthAmountChange: () => undefined,
    onDepositTokenAmountChange: () => undefined,
    onDepositEthToEmbedded: () => undefined,
    onDepositTokenToEmbedded: () => undefined,
  };
  const privyPanelMarkup = renderToStaticMarkup(React.createElement(
    walletSettingsPrivyPanel.WalletSettingsPrivyPanel,
    { ...privyPanelProps, embeddedAddressCopied: false },
  ));
  assert.match(privyPanelMarkup, /From external: <span[^>]*>0x2222\.\.\.2222<\/span>/, "Privy top-up must identify the source wallet");
  assert.match(privyPanelMarkup, /To Privy: <span[^>]*>0x1111\.\.\.1111<\/span>/, "Privy top-up must identify the recipient wallet");
  assert.match(
    privyPanelMarkup,
    /<button(?=[^>]*aria-label="Copy Privy wallet address")(?=[^>]*title="Copy Privy wallet address")[^>]*>/,
    "Privy wallet copy action must expose its ready accessible name and hover label",
  );
  const copiedPrivyPanelMarkup = renderToStaticMarkup(React.createElement(
    walletSettingsPrivyPanel.WalletSettingsPrivyPanel,
    { ...privyPanelProps, embeddedAddressCopied: true },
  ));
  assert.match(
    copiedPrivyPanelMarkup,
    /<button(?=[^>]*aria-label="Privy wallet address copied")(?=[^>]*title="Privy wallet address copied")[^>]*>/,
    "Privy wallet copy action must expose its completed accessible name and hover label",
  );

  const pendingTransferPresentation = walletTransferRow.getWalletTransferRowPresentation(
    "Send ETH",
    true,
    true,
  );
  assert.deepEqual(pendingTransferPresentation, {
    state: "pending",
    actionLabel: "Send ETH in progress",
    buttonText: "Sending...",
    announce: true,
  });
  const pendingTransferHtml = renderToStaticMarkup(React.createElement(
    walletTransferRow.WalletTransferRow,
    {
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
    },
  ));
  assert.match(
    pendingTransferHtml,
    /data-transfer-action-state="pending"[\s\S]*role="status" aria-live="polite">Send ETH in progress/,
    "wallet top-up transfer rows must announce the current pending presentation",
  );
  assert.match(
    pendingTransferHtml,
    /<input[^>]*aria-label="ETH transfer amount"/,
    "wallet top-up amount input must expose its asset label",
  );
  assert.match(
    pendingTransferHtml,
    /<button[^>]*aria-label="Send ETH in progress"[^>]*title="Send ETH in progress"/,
    "wallet top-up action must expose the model-derived action label and title",
  );
  const defaultUiButtonMarkup = renderToStaticMarkup(React.createElement(uiButton.UiButton, null, "Action"));
  assert.match(defaultUiButtonMarkup, /<button[^>]*type="button"/);

  assert.deepEqual(
    miningGuards.getManualBetNotification("signing"),
    ["Signing bet transaction.", "info"],
    "manual betting must identify the signing phase without ambiguous preparing copy",
  );
  assert.deepEqual(
    miningGuards.getManualBetNotification("pending"),
    ["Bet transaction submitted and is still pending. Waiting for on-chain confirmation.", "info"],
    "manual betting must identify the submitted transaction as still pending",
  );
  assert.deepEqual(
    miningGuards.getManualBetNotification("confirmed"),
    ["Bet confirmed on-chain.", "success"],
    "manual betting must identify the confirmed phase and success tone",
  );
}
