import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as autoResolveModule from "../app/hooks/useAutoResolve.ts";
import * as backupGateModule from "../app/components/BackupGate.tsx";
import * as miningManualActionsModule from "../app/hooks/useMiningManualActions.ts";
import * as maintenanceOverlayModule from "../app/components/MaintenanceOverlay.tsx";
import * as mobileTabNavModule from "../app/components/MobileTabNav.tsx";
import * as hubGameBoardModule from "../app/components/HubGameBoard.tsx";

const autoResolve = autoResolveModule.default ?? autoResolveModule;
const backupGate = backupGateModule.default ?? backupGateModule;
const miningManualActions = miningManualActionsModule.default ?? miningManualActionsModule;
const maintenanceOverlay = maintenanceOverlayModule.default ?? maintenanceOverlayModule;
const mobileTabNav = mobileTabNavModule.default ?? mobileTabNavModule;
const MaintenanceOverlay = maintenanceOverlay.MaintenanceOverlay;
const MobileTabNav = mobileTabNav.MobileTabNav;
const hubGameBoard = hubGameBoardModule.default ?? hubGameBoardModule;
const HubGameBoard = hubGameBoard.HubGameBoard;

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [path] : [];
  });
}

export async function runWalletShellAndMiningActionTests() {
  const publicConfigSource = readFileSync("config/publicConfig.ts", "utf8");
  const providersSource = readFileSync("app/providers.tsx", "utf8");
  assert.match(
    providersSource,
    /coinbaseWallet[\s\S]*preference[\s\S]*options:\s*['"]eoaOnly['"]/,
    "Privy Coinbase connector must avoid unsupported smart-wallet mode on Linea networks",
  );
  const walletSettingsModalSource = readFileSync("app/components/WalletSettingsModal.tsx", "utf8");
  assert.match(
    walletSettingsModalSource,
    /aria-label="Export support logs"[\s\S]*className="text-xs"[\s\S]*hidden sm:inline">Export Logs/,
    "mobile Wallet Settings must keep support-log export available as an accessible icon button",
  );
  assert.match(
    walletSettingsModalSource,
    /useDialogFocusTrap<HTMLDivElement>\(isOpen, onClose\)/,
    "Wallet Settings must use the shared focus trap with hidden-control and escaped-focus recovery",
  );
  assert.match(
    walletSettingsModalSource,
    /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="wallet-settings-title"[\s\S]*aria-describedby="wallet-settings-description"[\s\S]*tabIndex=\{-1\}/,
    "Wallet Settings dialog root must remain programmatically focusable for focus-trap fallback",
  );
  const backupAddress = "0x0000000000000000000000000000000000000001";
  assert.equal(backupGate.normalizeBackupAddress(backupAddress.toUpperCase().replace("0X", "0x")), backupAddress);
  assert.equal(backupGate.normalizeBackupAddress("not-an-address"), null);
  assert.deepEqual(hubGameBoard.getOnboardingState({
    walletAddress: null,
    walletConnected: false,
    formattedBalance: null,
    lowEthBalance: true,
  }), {
    wallet: false,
    backup: false,
    eth: false,
    linea: false,
    firstBet: false,
  }, "a guest must not be told that a wallet backup was saved");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storedValues = new Map([["lineaore:privy-backup-confirmed", "invalid-address"]]);
  const removedStorageKeys = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => storedValues.get(key) ?? null,
        removeItem: (key) => {
          removedStorageKeys.push(key);
          storedValues.delete(key);
        },
        setItem: (key, value) => storedValues.set(key, value),
      },
    },
  });
  try {
    assert.equal(backupGate.getBackupConfirmedAddress(), null);
    assert.deepEqual(removedStorageKeys, ["lineaore:privy-backup-confirmed"]);
    backupGate.setBackupConfirmed(backupAddress.toUpperCase().replace("0X", "0x"));
    assert.equal(storedValues.get("lineaore:privy-backup-confirmed"), backupAddress);
    assert.equal(backupGate.isBackupConfirmedFor(backupAddress), true);
    assert.equal(backupGate.isBackupConfirmedFor("invalid-address"), false);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
  assert.deepEqual(backupGate.getBackupGateActionState(false, false), {
    exportDisabled: false,
    exportLabel: "Export private key",
    continueDisabled: true,
  });
  assert.deepEqual(backupGate.getBackupGateActionState(true, true), {
    exportDisabled: true,
    exportLabel: "Opening...",
    continueDisabled: false,
  });
  const backupGateMarkup = renderToStaticMarkup(React.createElement(backupGate.BackupGate, {
    embeddedWalletAddress: backupAddress,
    onExportPrivateKey: () => {},
    onConfirm: () => {},
  }));
  assert.match(backupGateMarkup, /role="dialog"/);
  assert.match(backupGateMarkup, /aria-modal="true"/);
  assert.match(backupGateMarkup, /aria-labelledby="backup-gate-title"/);
  assert.match(backupGateMarkup, /aria-describedby="backup-gate-description"/);
  assert.match(backupGateMarkup, /tabindex="-1"/);
  assert.match(backupGateMarkup, /id="backup-gate-description"/);
  assert.match(backupGateMarkup, /Export private key/);
  assert.match(backupGateMarkup, /I&#x27;ve saved it, continue/);
  const backupGateButtons = [...backupGateMarkup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0]);
  const exportButton = backupGateButtons.find((button) => button.includes("Export private key"));
  const continueButton = backupGateButtons.find((button) => button.includes("I&#x27;ve saved it, continue"));
  assert.ok(exportButton);
  assert.ok(continueButton);
  assert.doesNotMatch(exportButton, /\bdisabled=/);
  assert.match(continueButton, /\bdisabled=/);
  assert.equal(
    backupGateButtons.filter((button) => button.includes("focus-visible:ring-violet-400")).length,
    2,
    "both backup actions must expose the shared keyboard focus ring",
  );
  assert.doesNotMatch(backupGateMarkup, /Opening(?:\u2026|\.\.\.)/);
  const mobileTabNavMarkup = renderToStaticMarkup(React.createElement(MobileTabNav, {
    activeTab: "hub",
    onTabChange: () => {},
  }));
  const mobileTabButtons = [...mobileTabNavMarkup.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
  assert.equal(mobileTabButtons.length, 6, "mobile navigation must render every public tab");
  assert.ok(mobileTabButtons.every((button) => /\btype="button"/.test(button)), "mobile navigation actions must not submit surrounding forms");
  assert.equal(mobileTabButtons.filter((button) => /aria-current="page"/.test(button)).length, 1, "only the active mobile tab must expose current-page semantics");
  assert.match(mobileTabButtons[0], /aria-label="Hub"[\s\S]*aria-current="page"[\s\S]*aria-pressed="true"/, "the active mobile tab must expose its accessible label and selection state");
  const maintenanceOverlayMarkup = renderToStaticMarkup(React.createElement(MaintenanceOverlay));
  assert.match(
    maintenanceOverlayMarkup,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*aria-labelledby="maintenance-title"[\s\S]*aria-describedby="maintenance-description"[\s\S]*id="maintenance-title"[\s\S]*id="maintenance-description"/,
    "maintenance overlay must announce busy status with stable title and description wiring",
  );
  assert.match(
    maintenanceOverlayMarkup,
    /aria-hidden="true"[\s\S]*orb-drift-1[\s\S]*aria-hidden="true"[\s\S]*opacity-\[0\.03\][\s\S]*aria-hidden="true"[\s\S]*animate-gradient-x/,
    "maintenance overlay decorative animation layers must stay hidden from assistive technology",
  );
  const pageTabPanelsSource = readFileSync("app/components/PageTabPanels.tsx", "utf8");
  assert.match(
    pageTabPanelsSource,
    /const TabPanelFallback[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-busy="true"[\s\S]*Loading panel/,
    "lazy tab panel fallback must announce loading state without changing tab behavior",
  );
  const notifications = [];
  const pendingStates = [];
  const selections = [];
  const selectionEpochs = [];
  const inFlightRef = { current: false };
  let submitCalls = 0;
  const actionBase = {
    tiles: [3, 3, 7],
    betAmountStr: "1",
    expectedEpoch: 42n,
    inFlightRef,
    autoMineActive: () => false,
    getActorAddress: () => backupAddress,
    notify: (message, tone) => notifications.push([message, tone]),
    setIsPending: (value) => pendingStates.push(value),
    setSelectedTiles: (tiles) => selections.push(tiles),
    setSelectedTilesEpoch: (epoch) => selectionEpochs.push(epoch),
    submitMineAttempt: async () => {
      submitCalls += 1;
      return "pending";
    },
  };
  assert.equal(await miningManualActions.executeMiningManualAction({
    ...actionBase,
    source: "ManualMine",
    getActorAddress: () => null,
  }), false);
  assert.deepEqual(notifications.pop(), ["Wallet not ready. Reconnect wallet and try again.", "danger"]);
  assert.equal(submitCalls, 0);
  assert.deepEqual(pendingStates, []);
  assert.equal(await miningManualActions.executeMiningManualAction({ ...actionBase, source: "ManualMine" }), "pending");
  assert.equal(submitCalls, 1);
  assert.deepEqual(pendingStates, [true, false]);
  assert.deepEqual(notifications.pop(), [
    "Bet transaction is still pending. Check wallet activity before retrying.",
    "warning",
  ]);
  assert.equal(inFlightRef.current, false);
  assert.equal(await miningManualActions.executeMiningManualAction({ ...actionBase, source: "DirectMine" }), "pending");
  assert.deepEqual(notifications.pop(), [
    "Repeat bet transaction is still pending. Check wallet activity before retrying.",
    "warning",
  ]);
  assert.deepEqual(selections.at(-1), [3, 7]);
  assert.equal(selectionEpochs.at(-1), null);
  const submitCallsBeforeAutoMineGuard = submitCalls;
  assert.equal(await miningManualActions.executeMiningManualAction({
    ...actionBase,
    source: "ManualMine",
    autoMineActive: () => true,
  }), false);
  assert.equal(submitCalls, submitCallsBeforeAutoMineGuard);

  let releaseFirstAttempt;
  const firstAttempt = miningManualActions.executeMiningManualAction({
    ...actionBase,
    source: "DirectMine",
    submitMineAttempt: () => new Promise((resolve) => { releaseFirstAttempt = resolve; }),
  });
  assert.equal(inFlightRef.current, true);
  assert.equal(await miningManualActions.executeMiningManualAction({ ...actionBase, source: "DirectMine" }), false);
  releaseFirstAttempt("confirmed");
  assert.equal(await firstAttempt, "confirmed");
  assert.deepEqual(selections.at(-1), [3, 7]);
  assert.equal(selectionEpochs.at(-1), null);
  assert.equal(inFlightRef.current, false);

  let clearedPendingState = 0;
  let loggedFailures = 0;
  assert.equal(await miningManualActions.executeMiningManualAction({
    ...actionBase,
    source: "DirectMine",
    submitMineAttempt: async () => { throw { code: 4001 }; },
    clearPendingState: () => { clearedPendingState += 1; },
  }), false);
  assert.equal(clearedPendingState, 0, "wallet rejection must preserve recoverable pending state");
  assert.deepEqual(notifications.pop(), ["Repeat bet transaction rejected in wallet.", "info"]);
  assert.equal(await miningManualActions.executeMiningManualAction({
    ...actionBase,
    source: "ManualMine",
    submitMineAttempt: async () => { throw { code: 4001 }; },
    clearPendingState: () => { clearedPendingState += 1; },
  }), false);
  assert.equal(clearedPendingState, 0, "manual wallet rejection must preserve recoverable pending state");
  assert.deepEqual(notifications.pop(), ["Bet transaction rejected in wallet.", "info"]);
  assert.equal(await miningManualActions.executeMiningManualAction({
    ...actionBase,
    source: "ManualMine",
    submitMineAttempt: async () => { throw new Error("raw provider failure"); },
    clearPendingState: () => { clearedPendingState += 1; },
    getFailureMessage: () => "Sanitized bet failure",
    logFailure: () => { loggedFailures += 1; },
  }), false);
  assert.equal(clearedPendingState, 1);
  assert.equal(loggedFailures, 1);
  assert.deepEqual(notifications.pop(), ["Sanitized bet failure", "danger"]);
  assert.equal(
    notifications.some(([message]) => /Preparing (?:repeat )?bet(?: transaction)?/.test(message)),
    false,
    "manual and repeat actions must not emit redundant preparation notices",
  );
  const autoResolveSource = readFileSync("app/hooks/useAutoResolve.ts", "utf8");
  assert.match(
    autoResolveSource,
    /function getBootstrapRetryDelayMs/,
    "auto-resolve must centralize bootstrap retryAfter clamping",
  );
  assert.equal(autoResolve.getBootstrapRetryDelayMs(undefined), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(-1), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("5"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("90"), 90_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(10_000), 300_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("1e2"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("90.5"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("00090"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(Number.MAX_SAFE_INTEGER + 1), 30_000);
  assert.equal(await autoResolve.readEpochHasPool(undefined, "42"), false);
  {
    let readContractCalls = 0;
    const zeroPoolClient = {
      readContract: async (request) => {
        readContractCalls += 1;
        assert.equal(request.functionName, "epochs");
        assert.deepEqual(request.args, [42n]);
        return [0n, 0n, 0n, false, false, false];
      },
    };
    assert.equal(await autoResolve.readEpochHasPool(zeroPoolClient, "42"), false);
    assert.equal(readContractCalls, 1, "auto-resolve precheck must read the epoch exactly once");
  }
  {
    const fundedPoolClient = {
      readContract: async () => [1n, 0n, 0n, false, false, false],
    };
    assert.equal(await autoResolve.readEpochHasPool(fundedPoolClient, "43"), true);
  }
  {
    const failingClient = {
      readContract: async () => {
        throw new Error("rpc unavailable");
      },
    };
    assert.equal(await autoResolve.readEpochHasPool(failingClient, "44"), false);
  }
  assert.match(
    autoResolveSource,
    /function parseRetryAfterSeconds[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\{0,5\}\)\$\/[\s\S]*Number\.parseInt\(trimmed, 10\)[\s\S]*const retryAfterSeconds = parseRetryAfterSeconds\(retryAfter\)/,
    "auto-resolve retryAfter must use canonical bounded seconds parsing before backoff clamping",
  );
  assert.match(
    autoResolveSource,
    /readJsonResponse<BootstrapResolvePayload>/,
    "auto-resolve bootstrap response parsing must use the bounded JSON response helper",
  );
  assert.match(
    autoResolveSource,
    /export async function readEpochHasPool\(publicClient: PublicClient \| undefined, epochKey: string\)[\s\S]*if \(!publicClient\) return false[\s\S]*publicClient\.readContract\(\{[\s\S]*functionName:\s*"epochs"[\s\S]*return epochData\[0\] > 0n[\s\S]*catch \{[\s\S]*return false[\s\S]*fetch\("\/api\/bootstrap-resolve"/,
    "browser auto-resolve must fail closed unless a read-only epoch precheck proves a funded pool before the server keeper API trigger",
  );
  assert.match(
    autoResolveSource,
    /payload\?\.ok && payload\.action === "pending"[\s\S]*server keeper resolve tx pending[\s\S]*markRetryScheduled\(epochKey\)[\s\S]*getBootstrapRetryDelayMs\(payload\.retryAfter\)[\s\S]*continue;/,
    "browser auto-resolve must treat keeper receipt timeouts as pending states with guarded retry/backoff",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /\b(?:useWriteContract|writeContractAsync|sendTransactionSilent|sendTransactionFromExternal|walletClient|eth_sendTransaction|sendTransaction\s*\(|writeContract\s*\(|simulateContract|encodeFunctionData)\b|\bbody\s*:/,
    "browser auto-resolve must not import or call wallet/write/send primitives or attach a mutation payload",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /res\.json\(\)|response\.json\(\)/,
    "auto-resolve bootstrap response parsing must not use unbounded response.json",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /Number\(payload\??\.retryAfter \?\? 0\)\s*\*\s*1000|Number\(retryAfter\)/,
    "auto-resolve must not trust raw retryAfter values from bootstrap responses",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /sendTransactionSilent|encodeFunctionData|functionName:\s*"resolveEpoch"|ENABLE_AUTO_RESOLVE_SWEEP/,
    "browser auto-resolve must not keep dormant client wallet resolve transaction paths",
  );
  const allowedClientResolveReferences = new Set([
    join("app", "components", "WhitePaper.tsx"),
    join("app", "hooks", "useAutoResolve.ts"),
    join("app", "lib", "constants.ts"),
  ]);
  const unexpectedClientResolveReferences = listSourceFiles("app")
    .filter((filePath) => !filePath.startsWith(join("app", "api")))
    .filter((filePath) => !allowedClientResolveReferences.has(filePath))
    .filter((filePath) => readFileSync(filePath, "utf8").includes("resolveEpoch"));
  assert.deepEqual(
    unexpectedClientResolveReferences,
    [],
    "client source must not retain dormant resolveEpoch wallet/sweep references outside ABI, docs, or the fetch-only bootstrap hook",
  );
  assert.doesNotMatch(
    publicConfigSource,
    /NEXT_PUBLIC_ENABLE_CLIENT_AUTO_RESOLVE|NEXT_PUBLIC_ENABLE_AUTO_RESOLVE_SWEEP|getConfiguredAutoResolveSweepEnabled|DEFAULT_AUTO_RESOLVE_SWEEP_ENABLED/,
    "public config must not expose a browser auto-resolve sweep flag",
  );
  assert.match(
    publicConfigSource,
    /function getConfiguredClientAutoResolveEnabled\(explicitFlag\?: string \| null\)[\s\S]*void explicitFlag;[\s\S]*return DEFAULT_CLIENT_AUTO_RESOLVE_ENABLED;/,
    "client bootstrap resolve config must ignore public opt-in flags and remain isolated from browser runtime",
  );
}
