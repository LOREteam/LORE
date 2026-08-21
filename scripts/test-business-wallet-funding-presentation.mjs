import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as uiButtonModule from "../app/components/ui/UiButton.tsx";
import * as walletTransferRowModule from "../app/components/wallet/WalletTransferRow.tsx";
import * as manualBetFormModule from "../app/hooks/useManualBetForm.ts";
import * as appConstantsModule from "../app/lib/constants.ts";

const uiButton = uiButtonModule.default ?? uiButtonModule;
const walletTransferRow = walletTransferRowModule.default ?? walletTransferRowModule;

const manualBetForm = manualBetFormModule.default ?? manualBetFormModule;
const appConstants = appConstantsModule.default ?? appConstantsModule;
const MANUAL_BET_AMOUNT_KEY = `lineaore:manual-bet-amount:v2:${appConstants.APP_CHAIN_ID}:${appConstants.CONTRACT_ADDRESS.toLowerCase()}`;
const LEGACY_MANUAL_BET_AMOUNT_KEY = "lineaore:manual-bet-amount:v1";

function createManualBetStorage(initialEntries = []) {
  const values = new Map(initialEntries);
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}
export function runWalletFundingPresentationTests() {
  const fundingManualFormSource = readFileSync("app/hooks/useManualBetForm.ts", "utf8");
  const autoMinerFormSource = readFileSync("app/hooks/useAutoMinerForm.ts", "utf8");
  const fundingBetPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  const fundingPrivyPanelSource = readFileSync("app/components/wallet/WalletSettingsPrivyPanel.tsx", "utf8");
  assert.match(fundingManualFormSource, /lineaDeficit/, "manual betting must expose the exact LINEA shortfall");
  assert.match(
    fundingManualFormSource,
    /function formatManualNumberDisplay\(value: number \| null \| undefined, fractionDigits = 2\)[\s\S]*formatDecimalTextFixed\(String\(value\), fractionDigits\)[\s\S]*totalBetDisplay[\s\S]*balanceDisplay[\s\S]*lineaDeficitDisplay/,
    "manual betting display amounts must be prepared through canonical decimal display formatting",
  );
  assert.match(
    fundingManualFormSource,
    /const \[manualBetStorageReady, setManualBetStorageReady\] = useState\(false\);[\s\S]*setManualBetStorageReady\(true\);[\s\S]*if \(!manualBetStorageReady\) return;[\s\S]*persistManualBetAmount\(window\.localStorage, betAmount\);[\s\S]*\}, \[betAmount, manualBetStorageReady\]\);/,
    "manual bet storage must not persist the default amount before restore completes",
  );
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
  assert.match(
    autoMinerFormSource,
    /lineaore:auto-miner-inputs:v2:\$\{APP_CHAIN_ID\}:\$\{CONTRACT_ADDRESS\.toLowerCase\(\)\}/,
    "auto-miner settings cache must be chain and contract scoped before mainnet",
  );
  assert.match(
    autoMinerFormSource,
    /validateBetAmount\(betSize\) !== null[\s\S]*window\.localStorage\.removeItem\(AUTOMINER_INPUTS_KEY\)[\s\S]*window\.localStorage\.setItem\(AUTOMINER_INPUTS_KEY/,
    "auto-miner input cache must drop invalid in-progress bet sizes instead of restoring stale bad input",
  );
  assert.match(
    readFileSync("scripts/smoke-browser.mjs", "utf8"),
    /lineaore:auto-miner-inputs:v2:\$\{SMOKE_CHAIN_ID\}:\$\{process\.env\.NEXT_PUBLIC_CONTRACT_ADDRESS\.toLowerCase\(\)\}/,
    "browser smoke must verify the same chain and contract scoped auto-miner cache key as runtime",
  );
  assert.match(
    fundingBetPanelSource,
    /function formatPanelNumber\(value: number \| null \| undefined, fractionDigits: number, fallback: string\)[\s\S]*formatDecimalTextFixed\(String\(value\), fractionDigits\)[\s\S]*top up \{lineaDeficitDisplay\} LINEA/,
    "manual and Auto-Miner top-up copy must show the top-up amount through canonical decimal display formatting",
  );
  assert.doesNotMatch(
    fundingBetPanelSource,
    /totalBet\.toFixed|totalCost\.toFixed|lineaDeficit\.toFixed|balance\?\.toFixed|\(balance \?\? 0\)\.toFixed/,
    "manual and Auto-Miner visible LINEA amounts must not render through direct .toFixed() calls",
  );
  assert.match(fundingPrivyPanelSource, /From external:/, "Privy top-up must identify the source wallet");
  assert.match(fundingPrivyPanelSource, /To Privy:/, "Privy top-up must identify the recipient wallet");
  assert.match(
    fundingPrivyPanelSource,
    /aria-label=\{embeddedAddressCopied \? "Privy wallet address copied" : "Copy Privy wallet address"\}[\s\S]*title=\{embeddedAddressCopied \? "Privy wallet address copied" : "Copy Privy wallet address"\}/,
    "Privy wallet copy action must expose a contextual accessible name and hover label",
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

  const walletSettingsModalSource = readFileSync("app/components/WalletSettingsModal.tsx", "utf8");
  assert.match(
    walletSettingsModalSource,
    /max-h-\[calc\(100dvh-1rem\)\]/,
    "Wallet Settings must stay inside the dynamic viewport when a mobile keyboard opens",
  );
  assert.match(walletSettingsModalSource, /min-h-0 flex-1/, "Wallet Settings content must shrink and scroll inside the modal");

  const miningGuardsSource = readFileSync("app/hooks/useMiningGuards.ts", "utf8");
  assert.match(miningGuardsSource, /Signing bet transaction\./, "manual betting must identify the signing phase");
  assert.match(miningGuardsSource, /submitted and is still pending/, "manual betting must identify the pending phase");
  assert.match(miningGuardsSource, /Bet confirmed on-chain\./, "manual betting must identify the confirmed phase");
  assert.doesNotMatch(miningGuardsSource, /Preparing bet transaction/, "manual betting must not use an ambiguous preparing phase");
  assert.doesNotMatch(
    miningGuardsSource,
    /Preparing bet in your Privy wallet/,
    "manual betting must not show the removed wallet-preparing copy",
  );
}
