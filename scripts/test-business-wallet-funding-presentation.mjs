import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as walletTransferRowModule from "../app/components/wallet/WalletTransferRow.tsx";

const walletTransferRow = walletTransferRowModule.default ?? walletTransferRowModule;

export function runWalletFundingPresentationTests() {
  const fundingManualFormSource = readFileSync("app/hooks/useManualBetForm.ts", "utf8");
  const autoMinerFormSource = readFileSync("app/hooks/useAutoMinerForm.ts", "utf8");
  const fundingBetPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  const fundingPrivyPanelSource = readFileSync("app/components/wallet/WalletSettingsPrivyPanel.tsx", "utf8");
  assert.match(fundingManualFormSource, /lineaDeficit/, "manual betting must expose the exact LINEA shortfall");
  assert.match(
    fundingManualFormSource,
    /validateBetAmount\(betAmount\) !== null[\s\S]*window\.localStorage\.removeItem\(MANUAL_BET_AMOUNT_KEY\)[\s\S]*window\.localStorage\.setItem\(MANUAL_BET_AMOUNT_KEY, betAmount\)/,
    "manual bet amount cache must drop invalid in-progress values instead of restoring stale bad input",
  );
  assert.match(
    fundingManualFormSource,
    /function formatManualNumberDisplay\(value: number \| null \| undefined, fractionDigits = 2\)[\s\S]*formatDecimalTextFixed\(String\(value\), fractionDigits\)[\s\S]*totalBetDisplay[\s\S]*balanceDisplay[\s\S]*lineaDeficitDisplay/,
    "manual betting display amounts must be prepared through canonical decimal display formatting",
  );
  assert.match(
    fundingManualFormSource,
    /if \(raw != null\) \{[\s\S]*else window\.localStorage\.removeItem\(MANUAL_BET_AMOUNT_KEY\)[\s\S]*if \(legacyRaw != null\) \{[\s\S]*window\.localStorage\.removeItem\(LEGACY_MANUAL_BET_AMOUNT_KEY\)[\s\S]*catch \{[\s\S]*window\.localStorage\.removeItem\(MANUAL_BET_AMOUNT_KEY\)[\s\S]*window\.localStorage\.removeItem\(LEGACY_MANUAL_BET_AMOUNT_KEY\)/,
    "manual bet amount restore must clear invalid current and legacy localStorage entries",
  );
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
  const uiButtonSource = readFileSync("app/components/ui/UiButton.tsx", "utf8");
  assert.match(
    uiButtonSource,
    /type\s*=\s*"button"[\s\S]*<button[\s\S]*type=\{type\}/,
    "shared UiButton must default to non-submit semantics for reusable wallet/chat/admin actions",
  );

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
