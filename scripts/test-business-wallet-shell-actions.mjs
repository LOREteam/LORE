import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import * as miningGuardsModule from "../app/hooks/useMiningGuards.ts";

const autoResolve = autoResolveModule.default ?? autoResolveModule;
const backupGate = backupGateModule.default ?? backupGateModule;
const miningManualActions = miningManualActionsModule.default ?? miningManualActionsModule;
const maintenanceOverlay = maintenanceOverlayModule.default ?? maintenanceOverlayModule;
const mobileTabNav = mobileTabNavModule.default ?? mobileTabNavModule;
const MaintenanceOverlay = maintenanceOverlay.MaintenanceOverlay;
const MobileTabNav = mobileTabNav.MobileTabNav;
const hubGameBoard = hubGameBoardModule.default ?? hubGameBoardModule;
const miningGuards = miningGuardsModule.default ?? miningGuardsModule;

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [path] : [];
  });
}

function readIsolatedWalletShellBehavior() {
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
        import { mock } from "node:test";
        import { resolve } from "node:path";
        import { pathToFileURL } from "node:url";
        import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import * as pageTabPanelsModule from "./app/components/PageTabPanels.tsx";
        import * as publicConfigModule from "./config/publicConfig.ts";
        const walletSettingsClose = () => undefined;
        const walletSettingsFocusTrapCalls = [];
        mock.module(pathToFileURL(resolve("app/hooks/useDialogFocusTrap.ts")).href, {
          namedExports: {
            useDialogFocusTrap(active, onEscape, initialFocusSelector, externalRef) {
              walletSettingsFocusTrapCalls.push({
                active,
                sameOnEscape: onEscape === walletSettingsClose,
                initialFocusSelector: initialFocusSelector ?? null,
                externalRefProvided: externalRef !== undefined,
              });
              return { current: null };
            },
          },
        });
        const walletSettingsModalModule = await import("./app/components/WalletSettingsModal.tsx");
        const pageTabPanels = pageTabPanelsModule.default ?? pageTabPanelsModule;
        const PageTabPanels = pageTabPanels.PageTabPanels;
        const publicConfig = publicConfigModule.default ?? publicConfigModule;
        const walletSettingsModal = walletSettingsModalModule.default ?? walletSettingsModalModule;
        const markups = ["analytics", "rebate"].map((activeTab) => (
          renderToStaticMarkup(React.createElement(PageTabPanels, {
            activeTab,
            analyticsProps: {},
            hubProps: {},
            leaderboardsProps: { data: null, loading: false, error: null, refetch: () => {} },
            rebateProps: {},
          }))
        ));
        const noop = () => undefined;
        const walletSettingsMarkup = renderToStaticMarkup(React.createElement(
          walletSettingsModal.WalletSettingsModal,
          {
            isOpen: true,
            onClose: walletSettingsClose,
            connectedWalletAddress: null,
            embeddedWalletAddress: null,
            externalWalletAddress: null,
            formattedLineaBalance: null,
            formattedEthBalance: null,
            withdrawAmount: "",
            withdrawEthAmount: "",
            depositEthAmount: "",
            depositTokenAmount: "",
            isWithdrawing: false,
            isWithdrawingEth: false,
            isDepositingEth: false,
            isDepositingToken: false,
            onWithdrawAmountChange: noop,
            onWithdrawEthAmountChange: noop,
            onDepositEthAmountChange: noop,
            onDepositTokenAmountChange: noop,
            onCreateEmbeddedWallet: async () => undefined,
            walletSetupCreating: false,
            walletSetupError: null,
            onCopyEmbeddedAddress: noop,
            onExportEmbeddedWallet: noop,
            onWithdrawToExternal: noop,
            onWithdrawEthToExternal: noop,
            onDepositEthToEmbedded: noop,
            onDepositTokenToEmbedded: noop,
            walletTransfers: null,
            walletTransfersLoading: false,
            onLoadWalletTransfers: noop,
            deepScanWins: null,
            deepScanScanning: false,
            deepScanClaiming: false,
            deepScanProgress: "",
            onDeepScan: noop,
            onDeepScanStop: noop,
            onDeepClaimOne: noop,
            onDeepClaimAll: noop,
            connectedResolverRewards: "0",
            connectedResolverRewardsWei: 0n,
            embeddedResolverRewards: "0",
            embeddedResolverRewardsWei: 0n,
            isClaimingConnectedResolverRewards: false,
            isClaimingEmbeddedResolverRewards: false,
            onClaimConnectedResolverRewards: noop,
            onClaimEmbeddedResolverRewards: noop,
            pendingTransactionStatus: null,
            isRefreshingPendingTx: false,
            isCancellingPendingTx: false,
            onRefreshPendingTx: noop,
            onCancelPendingTx: noop,
          },
        ));
        console.log(JSON.stringify({
          markups,
          walletSettingsFocusTrap: {
            calls: walletSettingsFocusTrapCalls,
            dialogRendered: /role="dialog"/.test(walletSettingsMarkup),
          },
          clientAutoResolve: {
            enabled: publicConfig.getConfiguredClientAutoResolveEnabled(),
            forbiddenExports: [
              "getConfiguredAutoResolveSweepEnabled",
              "DEFAULT_AUTO_RESOLVE_SWEEP_ENABLED",
            ].filter((name) => Object.hasOwn(publicConfig, name)),
            explicitValues: [undefined, null, "", "0", "1", "true", "yes"].map(
              (explicitFlag) => publicConfig.getConfiguredClientAutoResolveEnabled(explicitFlag),
            ),
          },
        }));
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_ENABLE_CLIENT_AUTO_RESOLVE: "1",
        NEXT_PUBLIC_ENABLE_AUTO_RESOLVE_SWEEP: "true",
      },
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `isolated wallet-shell behavior probe failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function readIsolatedAutoResolveBehavior() {
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
        import { mock } from "node:test";
        import { resolve } from "node:path";
        import { setImmediate as waitForImmediate } from "node:timers/promises";
        import { pathToFileURL } from "node:url";

        const moduleUrl = (filePath) => pathToFileURL(resolve(filePath)).href;
        let effects = [];
        let events = [];
        let payload = null;
        let activeResponse = null;
        let readJsonCalls = 0;
        let responseJsonCalls = 0;
        let requestTimerSets = 0;
        let requestTimerClears = 0;

        mock.module("react", {
          namedExports: {
            useCallback: (callback) => callback,
            useEffect: (effect) => effects.push(effect),
            useRef: (value) => ({ current: value }),
          },
        });
        mock.module(moduleUrl("config/publicConfig.ts"), {
          namedExports: {
            getConfiguredClientAutoResolveEnabled: () => true,
          },
        });
        mock.module(moduleUrl("app/lib/constants.ts"), {
          namedExports: {
            CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
            GAME_ABI: [],
          },
        });
        mock.module(moduleUrl("app/lib/logger.ts"), {
          namedExports: {
            log: {
              info: (scope, message, details) => events.push(["log", "info", scope, message, details]),
              warn: (scope, message, details) => events.push(["log", "warn", scope, message, details]),
            },
          },
        });
        mock.module(moduleUrl("app/lib/readJsonResponse.ts"), {
          namedExports: {
            readJsonResponse: async (response) => {
              readJsonCalls += 1;
              events.push(["readJsonResponse", response === activeResponse]);
              return payload;
            },
          },
        });
        mock.module(moduleUrl("app/hooks/autoResolveStorage.ts"), {
          namedExports: {
            clearResolveGuard: () => events.push(["clearResolveGuard"]),
            readResolveGuard: () => null,
            writeResolveGuard: (epoch) => events.push(["writeResolveGuard", epoch]),
          },
        });
        mock.module(moduleUrl("app/hooks/autoResolveShared.ts"), {
          namedExports: {
            waitUnlessCancelled: async (_cancelled, delayMs) => {
              events.push(["waitUnlessCancelled", delayMs]);
              return false;
            },
          },
        });

        const imported = await import("./app/hooks/useAutoResolve.ts");
        const autoResolve = imported.default ?? imported;
        const originalSetTimeout = globalThis.setTimeout;
        const originalClearTimeout = globalThis.clearTimeout;
        const originalWindow = globalThis.window;
        const originalDocument = globalThis.document;
        const originalFetch = globalThis.fetch;
        const originalRandom = Math.random;
        let scheduled = [];
        const documentListeners = new Set();

        globalThis.setTimeout = (callback, delayMs) => {
          const timer = { callback, delayMs };
          scheduled.push(timer);
          return timer;
        };
        globalThis.clearTimeout = () => undefined;
        globalThis.window = {
          setTimeout: () => {
            requestTimerSets += 1;
            return 99;
          },
          clearTimeout: () => {
            requestTimerClears += 1;
          },
        };
        globalThis.document = {
          visibilityState: "visible",
          addEventListener: (_type, listener) => documentListeners.add(listener),
          removeEventListener: (_type, listener) => documentListeners.delete(listener),
        };
        Math.random = () => 0;

        async function settleUntil(done) {
          for (let attempt = 0; attempt < 20 && !done(); attempt += 1) {
            await Promise.resolve();
            await waitForImmediate();
          }
          if (!done()) throw new Error("auto-resolve behavior probe did not settle");
        }

        async function runScenario(poolAmount, nextPayload) {
          effects = [];
          events = [];
          scheduled = [];
          payload = nextPayload;
          readJsonCalls = 0;
          responseJsonCalls = 0;
          requestTimerSets = 0;
          requestTimerClears = 0;
          documentListeners.clear();
          activeResponse = {
            status: 200,
            json() {
              responseJsonCalls += 1;
              throw new Error("response.json must not be called");
            },
          };
          globalThis.fetch = async (input, init) => {
            events.push(["fetch", {
              input,
              method: init?.method,
              cache: init?.cache,
              headers: init?.headers,
              hasBody: Object.hasOwn(init ?? {}, "body"),
              hasSignal: Boolean(init?.signal),
            }]);
            return activeResponse;
          };
          const publicClient = new Proxy({
            async readContract(request) {
              events.push(["readContract", {
                functionName: request.functionName,
                args: request.args.map((value) => value.toString()),
              }]);
              return [poolAmount, 0n, 0n, false, false, false];
            },
          }, {
            get(target, property) {
              if (property in target) return target[property];
              throw new Error(\`unexpected public client member: \${String(property)}\`);
            },
          });

          autoResolve.useAutoResolve({
            actualCurrentEpoch: 42n,
            currentEpochResolved: false,
            publicClient,
            refetchEpoch: () => undefined,
            refetchGridEpochData: () => undefined,
            refetchTileData: () => undefined,
            refetchUserBets: () => undefined,
            timeLeft: 0,
          });
          const cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === "function");
          const startupTimer = scheduled.find((timer) => timer.delayMs === 4_000);
          if (!startupTimer) throw new Error("auto-resolve behavior probe did not schedule the keeper trigger");
          startupTimer.callback();
          await settleUntil(() => poolAmount === 0n
            ? events.some((event) => event[0] === "log" && event[3] === "skipping keeper trigger: epoch has no bets")
            : events.some((event) => event[0] === "waitUnlessCancelled"));
          for (const cleanup of cleanups.reverse()) cleanup();

          return {
            events,
            startupDelayMs: startupTimer.delayMs,
            readJsonCalls,
            responseJsonCalls,
            requestTimerSets,
            requestTimerClears,
            activeDocumentListenersAfterCleanup: documentListeners.size,
          };
        }

        try {
          const emptyPool = await runScenario(0n, null);
          const pending = await runScenario(1n, {
            ok: true,
            action: "pending",
            currentEpoch: "42",
            hash: "0xabc",
            retryAfter: 90,
          });
          console.log(JSON.stringify({ emptyPool, pending }));
        } finally {
          globalThis.setTimeout = originalSetTimeout;
          globalThis.clearTimeout = originalClearTimeout;
          globalThis.window = originalWindow;
          globalThis.document = originalDocument;
          globalThis.fetch = originalFetch;
          Math.random = originalRandom;
        }
      `,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `isolated auto-resolve behavior probe failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

export async function runWalletShellAndMiningActionTests() {
  const isolatedWalletShellBehavior = readIsolatedWalletShellBehavior();
  const isolatedAutoResolveBehavior = readIsolatedAutoResolveBehavior();
  const providersSource = readFileSync("app/providers.tsx", "utf8");
  assert.match(
    providersSource,
    /coinbaseWallet[\s\S]*preference[\s\S]*options:\s*['"]eoaOnly['"]/,
    "Privy Coinbase connector must avoid unsupported smart-wallet mode on Linea networks",
  );
  assert.deepEqual(
    isolatedWalletShellBehavior.walletSettingsFocusTrap,
    {
      calls: [{
        active: true,
        sameOnEscape: true,
        initialFocusSelector: null,
        externalRefProvided: false,
      }],
      dialogRendered: true,
    },
    "Wallet Settings must use the shared focus trap with hidden-control and escaped-focus recovery",
  );
  const backupAddress = "0x0000000000000000000000000000000000000001";
  assert.equal(backupGate.normalizeBackupAddress(backupAddress.toUpperCase().replace("0X", "0x")), backupAddress);
  assert.equal(backupGate.normalizeBackupAddress("not-an-address"), null);
  assert.deepEqual(hubGameBoard.getOnboardingState({
    walletAddress: null,
    walletConnected: false,
    formattedBalance: null,
    formattedEthBalance: null,
    lowEthBalance: true,
  }), {
    wallet: false,
    backup: false,
    eth: false,
    linea: false,
    firstBet: false,
  }, "a guest must not be told that a wallet backup was saved");
  assert.equal(hubGameBoard.getOnboardingState({
    walletAddress: backupAddress,
    walletConnected: true,
    formattedBalance: "1.00",
    formattedEthBalance: null,
    lowEthBalance: false,
  }).eth, false, "an unknown ETH read must not be presented as gas-ready");
  assert.deepEqual(
    hubGameBoard.getOnboardingNextAction({
      onboarding: { wallet: false, backup: false, eth: false, linea: false, firstBet: false },
      walletCta: "login",
    }),
    { kind: "login", label: "Log in to continue" },
    "the first unauthenticated checklist action must use the existing login flow",
  );
  assert.deepEqual(
    hubGameBoard.getOnboardingNextAction({
      onboarding: { wallet: true, backup: false, eth: false, linea: false, firstBet: false },
      walletCta: "ready",
    }),
    { kind: "settings", label: "Open Wallet Settings" },
    "backup and funding checklist steps must use the existing Wallet Settings flow",
  );
  assert.deepEqual(
    hubGameBoard.getOnboardingNextAction({
      onboarding: { wallet: true, backup: true, eth: true, linea: true, firstBet: false },
      walletCta: "ready",
    }),
    { kind: "bet", label: "Choose tiles and bet" },
    "the first-bet checklist step must only navigate to bet preparation",
  );
  const firstBetWallet = "0x0000000000000000000000000000000000000002";
  const secondBetWallet = "0x0000000000000000000000000000000000000003";
  const firstBetKey = miningGuards.confirmedFirstBetStorageKey(firstBetWallet);
  const secondBetKey = miningGuards.confirmedFirstBetStorageKey(secondBetWallet);
  assert.ok(firstBetKey);
  assert.ok(secondBetKey);
  assert.notEqual(firstBetKey, secondBetKey, "first-bet checklist markers must be scoped per wallet");
  assert.equal(miningGuards.confirmedFirstBetStorageKey("invalid-address"), null);
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
    storedValues.set(firstBetKey, "1");
    assert.equal(miningGuards.hasConfirmedFirstBet(firstBetWallet), true);
    assert.equal(miningGuards.hasConfirmedFirstBet(secondBetWallet), false, "a different wallet must not inherit the first-bet marker");
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
  const deferredPanelFallbackMarkups = isolatedWalletShellBehavior.markups;
  assert.equal(
    deferredPanelFallbackMarkups.every((markup) => (
      /^<div(?=[^>]*role="status")(?=[^>]*aria-live="polite")(?=[^>]*aria-busy="true")[^>]*>Loading panel\.\.\.<\/div>$/.test(markup)
    )),
    true,
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
  assert.equal(autoResolve.getBootstrapRetryDelayMs(undefined), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(-1), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("5"), 30_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs("90"), 90_000);
  assert.equal(autoResolve.getBootstrapRetryDelayMs(90), 90_000, "numeric retryAfter seconds must use the bounded delay policy");
  assert.equal(autoResolve.getBootstrapRetryDelayMs(" 90 "), 90_000, "canonical retryAfter text may contain surrounding whitespace");
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
  assert.deepEqual(
    isolatedAutoResolveBehavior.emptyPool,
    {
      events: [
        ["readContract", { functionName: "epochs", args: ["42"] }],
        ["log", "info", "AutoResolve", "skipping keeper trigger: epoch has no bets", { epoch: "42" }],
      ],
      startupDelayMs: 4_000,
      readJsonCalls: 0,
      responseJsonCalls: 0,
      requestTimerSets: 0,
      requestTimerClears: 0,
      activeDocumentListenersAfterCleanup: 0,
    },
    "browser auto-resolve must fail closed unless a read-only epoch precheck proves a funded pool before the server keeper API trigger",
  );
  const pendingAutoResolveEvents = isolatedAutoResolveBehavior.pending.events;
  assert.deepEqual(
    {
      fetch: pendingAutoResolveEvents.find((event) => event[0] === "fetch")?.[1],
      readJsonEvent: pendingAutoResolveEvents.find((event) => event[0] === "readJsonResponse"),
      readJsonCalls: isolatedAutoResolveBehavior.pending.readJsonCalls,
      requestTimerSets: isolatedAutoResolveBehavior.pending.requestTimerSets,
      requestTimerClears: isolatedAutoResolveBehavior.pending.requestTimerClears,
    },
    {
      fetch: {
        input: "/api/bootstrap-resolve",
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        hasBody: false,
        hasSignal: true,
      },
      readJsonEvent: ["readJsonResponse", true],
      readJsonCalls: 1,
      requestTimerSets: 1,
      requestTimerClears: 1,
    },
    "auto-resolve bootstrap response parsing must use the bounded JSON response helper",
  );
  assert.deepEqual(
    {
      eventOrder: pendingAutoResolveEvents.map((event) => event[0]),
      guardWrites: pendingAutoResolveEvents
        .filter((event) => event[0] === "writeResolveGuard")
        .map((event) => event[1]),
      pendingLog: pendingAutoResolveEvents.find((event) => (
        event[0] === "log" && event[3] === "server keeper resolve tx pending"
      )),
      waitDelays: pendingAutoResolveEvents
        .filter((event) => event[0] === "waitUnlessCancelled")
        .map((event) => event[1]),
      startupDelayMs: isolatedAutoResolveBehavior.pending.startupDelayMs,
      activeDocumentListenersAfterCleanup:
        isolatedAutoResolveBehavior.pending.activeDocumentListenersAfterCleanup,
    },
    {
      eventOrder: [
        "readContract",
        "writeResolveGuard",
        "fetch",
        "readJsonResponse",
        "log",
        "writeResolveGuard",
        "waitUnlessCancelled",
      ],
      guardWrites: ["42", "42"],
      pendingLog: [
        "log",
        "info",
        "AutoResolve",
        "server keeper resolve tx pending",
        { epoch: "42", hash: "0xabc", reason: "resolve_pending" },
      ],
      waitDelays: [90_000],
      startupDelayMs: 4_000,
      activeDocumentListenersAfterCleanup: 0,
    },
    "browser auto-resolve must treat keeper receipt timeouts as pending states with guarded retry/backoff",
  );
  assert.doesNotMatch(
    autoResolveSource,
    /\b(?:useWriteContract|writeContractAsync|sendTransactionSilent|sendTransactionFromExternal|walletClient|eth_sendTransaction|sendTransaction\s*\(|writeContract\s*\(|simulateContract|encodeFunctionData)\b|\bbody\s*:/,
    "browser auto-resolve must not import or call wallet/write/send primitives or attach a mutation payload",
  );
  assert.equal(
    isolatedAutoResolveBehavior.pending.responseJsonCalls,
    0,
    "auto-resolve bootstrap response parsing must not use unbounded response.json",
  );
  assert.deepEqual(
    ["0x5a", "1000000", {}, Number.POSITIVE_INFINITY]
      .map((retryAfter) => autoResolve.getBootstrapRetryDelayMs(retryAfter)),
    [30_000, 30_000, 30_000, 30_000],
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
  assert.deepEqual(
    {
      enabled: isolatedWalletShellBehavior.clientAutoResolve.enabled,
      forbiddenExports: isolatedWalletShellBehavior.clientAutoResolve.forbiddenExports,
    },
    { enabled: false, forbiddenExports: [] },
    "public auto-resolve flags must stay inert at import time and legacy sweep exports must stay absent",
  );
  assert.deepEqual(
    isolatedWalletShellBehavior.clientAutoResolve.explicitValues,
    [false, false, false, false, false, false, false],
    "client bootstrap resolve config must ignore public opt-in flags and remain isolated from browser runtime",
  );
}
