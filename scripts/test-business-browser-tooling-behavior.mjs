import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  MAX_API_LATENCY_SAMPLES_PER_PATH,
  addBoundedLatencySample,
  classifyBaselineConsoleError,
  classifyExpectedBaselineAbort,
  deriveBaselineQuality,
  installBrowserBaselineObservers,
  isBaselineLocalTarget,
  parseBrowserBaselineConfig,
  parseCanonicalInteger,
  parseLoopbackBaselineUrl,
  planBrowserBaselinePublication,
  sanitizeBaselineDiagnostic,
  summarizeLatencySamples,
  triggerSyntheticSoundToggle,
} from "./browser-baseline-model.mjs";
import {
  openLoginModal,
  openWalletSelectorFromLoginModal,
  verifyHubVisualRegressionGuards,
  verifyReadOnlyMode,
  verifyVisibleTouchTargets,
} from "./smoke-browser-lib/flows.mjs";
import { runBrowserBaselineCli } from "./measure-browser-baseline.mjs";
import {
  installSmokePageObservers,
  runSmokeBrowserEntrypoint,
} from "./smoke-browser.mjs";
import {
  parseBuildOutputConfig,
  runBuildOutputCli,
} from "./measure-build-output.mjs";
import {
  MAX_BROWSER_SMOKE_DIAGNOSTIC_CHARS,
  assertEmptyPoolChartVisual,
  classifyBrowserConsoleEvent,
  compactBrowserDiagnostic,
  compactPageError,
  assertNoUnattendedBootstrapResolveRequests,
  browserSmokeRequiredStepIssues,
  createIsolatedBrowserSmokePage,
  createBrowserSmokeStepRunner,
  fetchBrowserSmokeLiveState,
  isIgnoredHydrationNoise,
  isIgnoredPageError,
  openBrowserLoginModalWithSingleReload,
  REQUIRED_BROWSER_SMOKE_STEPS,
  parseBrowserSmokeContentLengthHeader,
  parseSmokeChainId,
  readBoundedBrowserSmokeJsonResponse,
  runBrowserSmokeCli,
} from "./smoke-browser-policy.mjs";

class FakeHTMLElement {
  constructor(options = {}) {
    this.textContent = options.text ?? "";
    this.disabled = options.disabled ?? false;
    this.style = { display: "block", visibility: "visible", opacity: "1", ...options.style };
    this.rect = { width: options.width ?? 44, height: options.height ?? 44 };
    this.attributes = new Map(Object.entries(options.attributes ?? {}));
    this.offsetWidth = this.rect.width;
    this.offsetHeight = this.rect.height;
    this.classList = { contains: (name) => (options.classes ?? []).includes(name) };
    this.onClick = options.onClick ?? (() => {});
  }

  click() { this.onClick(); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  getBoundingClientRect() { return { ...this.rect }; }
  getClientRects() { return this.rect.width > 0 && this.rect.height > 0 ? [this.rect] : []; }
}

class FakeHTMLButtonElement extends FakeHTMLElement {}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeSVGPathElement extends FakeHTMLElement {}

function createFakeBrowserPage() {
  const state = {
    modalOpen: false,
    selectorOpen: false,
    walletAttempt: 0,
    walletOptionsAvailable: false,
    keyPresses: [],
    waitCalls: 0,
  };
  const buttons = [];
  const loginButton = new FakeHTMLButtonElement({ text: "Login / Connect", disabled: true });
  const loginFallback = new FakeHTMLButtonElement({
    text: "LOGIN TO BET",
    onClick: () => { state.modalOpen = true; state.selectorOpen = false; },
  });
  const autoLoginFallback = new FakeHTMLButtonElement({ text: "LOGIN TO START" });
  const continueWallet = new FakeHTMLButtonElement({
    text: "Continue with a wallet",
    onClick: () => {
      state.walletAttempt += 1;
      state.selectorOpen = true;
      state.walletOptionsAvailable = state.walletAttempt >= 2;
    },
  });
  const metamask = new FakeHTMLButtonElement({ text: "MetaMask" });
  const coinbase = new FakeHTMLButtonElement({ text: "Coinbase Wallet" });
  buttons.push(loginButton, loginFallback, autoLoginFallback, continueWallet, metamask, coinbase);

  const manualAction = new FakeHTMLButtonElement({
    text: "BETTING PAUSED",
    disabled: true,
    attributes: { "data-testid": "manual-bet-action" },
  });
  const autoAction = new FakeHTMLButtonElement({
    text: "BETTING PAUSED",
    disabled: true,
    attributes: { "data-testid": "auto-miner-action" },
  });
  const manualInput = new FakeHTMLInputElement({ classes: ["lore-nums"] });
  const autoInputs = Array.from({ length: 3 }, () => new FakeHTMLInputElement({ classes: ["lore-nums"] }));
  const chartPath = new FakeSVGPathElement({ attributes: { d: "M0 1 L2 3" } });
  const touchTargets = [
    new FakeHTMLButtonElement({ text: "Hub", width: 44, height: 44 }),
    new FakeHTMLInputElement({ attributes: { "aria-label": "Amount" }, width: 48, height: 44 }),
  ];

  const visibleButtons = () => buttons.filter((button) => {
    if (button === continueWallet) return state.modalOpen;
    if (button === metamask || button === coinbase) return state.selectorOpen && state.walletOptionsAvailable;
    if (button === loginFallback || button === autoLoginFallback || button === loginButton) return !state.modalOpen;
    return true;
  });
  const document = {
    body: { innerText: "Mining Hub Manual Bet Auto-Miner" },
    documentElement: { scrollWidth: 430, clientWidth: 430 },
    getElementById: (id) => id === "bet-amount-per-tile" ? manualInput : null,
    querySelector: (selector) => {
      if (selector === '[data-testid="manual-bet-action"]') return manualAction;
      if (selector === '[data-testid="auto-miner-action"]') return autoAction;
      if (selector === '[data-testid="header-pool-chart-line"]') return chartPath;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "button") return visibleButtons();
      if (selector === ".control-panel-auto input.console-input") return autoInputs;
      if (selector.includes('button, input:not([type="hidden"])')) return touchTargets;
      return [];
    },
  };
  const window = {
    getComputedStyle: (element) => element.style,
    location: { hash: "" },
  };

  const withDom = async (callback) => {
    const previous = new Map();
    const replacements = {
      document,
      window,
      getComputedStyle: window.getComputedStyle,
      HTMLElement: FakeHTMLElement,
      HTMLButtonElement: FakeHTMLButtonElement,
      HTMLInputElement: FakeHTMLInputElement,
      SVGPathElement: FakeSVGPathElement,
    };
    for (const [name, value] of Object.entries(replacements)) {
      previous.set(name, globalThis[name]);
      globalThis[name] = value;
    }
    try {
      return await callback();
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    }
  };

  const roleVisible = (role, options) => {
    const name = options?.name;
    const matches = (text) => name instanceof RegExp ? name.test(text) : text === name;
    if (role === "heading" && matches("Log in or sign up")) return state.modalOpen && !state.selectorOpen;
    if (role === "heading" && matches("Select your wallet")) return state.selectorOpen;
    if (role === "button" && matches("Continue with a wallet")) return state.modalOpen;
    if (role === "button" && name instanceof RegExp && name.test("Login or connect wallet")) return !state.modalOpen;
    return true;
  };
  const selectorVisible = (selector) => {
    if (selector === "input[type='email']") return state.modalOpen && !state.selectorOpen;
    if (selector.includes("hub-read-only-banner")) return true;
    if (selector.includes("manual-bet-action")) return true;
    if (selector.includes("auto-miner-action")) return true;
    return selector === "[data-ui-hydrated='true']";
  };
  const locator = ({ selector, role, options, index }) => ({
    first() { return this; },
    nth(nextIndex) { return locator({ selector, role, options, index: nextIndex }); },
    async waitFor() {
      const visible = role ? roleVisible(role, options) : selectorVisible(selector);
      if (!visible) throw new Error(`locator not visible: ${selector || String(options?.name)}`);
    },
    async click() {
      if (selector === "button" && Number.isInteger(index)) {
        const button = visibleButtons()[index];
        if (!button) throw new Error("button index not found");
        button.click();
        return;
      }
      if (role === "button") {
        const button = visibleButtons().find((candidate) => matchesRoleName(candidate.textContent, options?.name));
        if (!button) throw new Error("role button not found");
        button.click();
      }
    },
  });
  const matchesRoleName = (text, name) => name instanceof RegExp ? name.test(text) : text === name;
  const page = {
    state,
    document,
    manualAction,
    autoAction,
    chartPath,
    touchTargets,
    locator: (selector) => locator({ selector }),
    getByRole: (role, options) => locator({ role, options }),
    keyboard: {
      async press(key) {
        state.keyPresses.push(key);
        if (key === "Escape") {
          state.modalOpen = false;
          state.selectorOpen = false;
        }
      },
    },
    async waitForTimeout() {},
    async waitForFunction(callback, argument) {
      state.waitCalls += 1;
      const result = await withDom(() => callback(argument));
      if (!result) throw new Error("page.waitForFunction: Timeout");
      return result;
    },
    async evaluate(callback, argument) {
      return withDom(() => callback(argument));
    },
  };
  return page;
}

function sampleReport() {
  return {
    schemaVersion: 1,
    startedAt: "2026-08-13T00:00:00.000Z",
    target: { kind: "local", origin: "http://localhost:3000", viewport: "1440x900" },
    observationMs: 10_000,
    quality: { status: "pass", issues: [] },
    vitals: { fcpMs: 1, lcpMs: 2, cls: 0, inpMs: 3 },
    resources: { count: 1, transferredBytes: 2, decodedBytes: 3, byType: {}, largestLocal: [{ path: "/secret" }] },
    requests: {
      sameOriginApiCount: 1,
      sameOriginApiPerMinute: 6,
      sameOriginApiResponseLatencyByPath: { "/api/live-state": { samples: 1, p95Ms: 4 } },
      externalFetchCount: 0,
      failedLocalResponseCount: 0,
      failedExternalResponseCount: 0,
      requestFailureCount: 0,
      localRequestFailureCount: 0,
      externalRequestFailureCount: 0,
      ignoredLocalRscAbortCount: 1,
      ignoredLocalWalletCoopAbortCount: 1,
      ignoredLocalChatPollAbortCount: 1,
      ignoredLocalRecentWinsPollAbortCount: 1,
      requestFailureSamples: [{ message: "private" }],
    },
    runtime: {
      initialDomNodes: 10,
      domNodes: 11,
      domNodeDelta: 1,
      jsHeapUsedBytes: 20,
      jsHeapUsedDeltaBytes: 2,
      maxJsHeapUsedBytes: 22,
      jsHeapPeakDeltaBytes: 4,
      maxDomNodes: 12,
      domNodePeakDelta: 2,
      samples: [{ elapsedMs: 1 }],
      longTaskCount: 0,
      longTaskTotalMs: 0,
      longestTaskMs: 0,
      consoleErrorCount: 0,
      consoleErrorsByKind: {},
      consoleErrorsByTarget: {},
      consoleErrorSamples: [{ message: "private" }],
    },
  };
}

function createFakeBuildOutputFs({ buildId = "build-fixture" } = {}) {
  const calls = [];
  const sizeByName = new Map([
    ["app.js", 400],
    ["vendor.js", 900],
    ["styles.css", 100],
    ["module.wasm", 200],
    ["note.txt", 50],
  ]);
  const fileEntry = (name) => ({
    name,
    isDirectory: () => false,
    isFile: () => true,
  });
  const directoryEntry = (name) => ({
    name,
    isDirectory: () => true,
    isFile: () => false,
  });
  const normalize = (value) => String(value).replaceAll("\\", "/");
  return {
    calls,
    api: {
      async readFile(file, encoding) {
        calls.push(["readFile", file, encoding]);
        if (normalize(file).endsWith("/BUILD_ID")) return buildId;
        throw new Error("unexpected fake build-output read");
      },
      async stat(file) {
        calls.push(["stat", file]);
        const normalized = normalize(file);
        if (normalized.endsWith("/BUILD_ID")) {
          return { size: buildId.length, mtime: new Date("2026-08-14T08:00:00.000Z") };
        }
        const name = normalized.split("/").at(-1);
        if (!sizeByName.has(name)) throw new Error("unexpected fake build-output stat");
        return { size: sizeByName.get(name) };
      },
      async readdir(directory, options) {
        calls.push(["readdir", directory, options]);
        const normalized = normalize(directory);
        if (normalized.endsWith("/static")) {
          return [
            directoryEntry("chunks"),
            fileEntry("styles.css"),
            fileEntry("module.wasm"),
            fileEntry("note.txt"),
          ];
        }
        if (normalized.endsWith("/static/chunks")) {
          return [fileEntry("app.js"), fileEntry("vendor.js")];
        }
        throw new Error("unexpected fake build-output directory");
      },
      async mkdir(directory, options) {
        calls.push(["mkdir", directory, options]);
      },
      async writeFile(file, contents, encoding) {
        calls.push(["writeFile", file, contents, encoding]);
      },
    },
  };
}

export async function runBrowserToolingBehaviorTests() {
  const buildSummaryFs = createFakeBuildOutputFs();
  const buildSummaryLogs = [];
  const buildSummary = await runBuildOutputCli({
    cwd: process.cwd(),
    env: {
      NEXT_DIST_DIR: ".next-behavior",
      BUNDLE_BASELINE_OUT: "artifacts/performance/ignored-summary.json",
    },
    argv: ["--summary-only"],
    fsApi: buildSummaryFs.api,
    now: () => new Date("2026-08-14T09:00:00.000Z"),
    log: (value) => buildSummaryLogs.push(value),
  });
  assert.equal(buildSummary.exitCode, 0);
  assert.equal(buildSummary.wroteArtifact, false);
  assert.equal(buildSummary.report.measuredAt, "2026-08-14T09:00:00.000Z");
  assert.equal(buildSummary.report.buildCompletedAt, "2026-08-14T08:00:00.000Z");
  assert.equal(buildSummary.report.fileCount, 5);
  assert.equal(buildSummary.report.totalBytes, 1_650);
  assert.deepEqual(buildSummary.report.bytesByExtension, {
    ".js": 1_300,
    ".wasm": 200,
    ".css": 100,
    ".txt": 50,
  });
  assert.deepEqual(buildSummary.report.largestJsFile, {
    path: "static/chunks/vendor.js",
    bytes: 900,
  });
  assert.deepEqual(buildSummary.report.largestFiles.slice(0, 2), [
    { path: "static/chunks/vendor.js", bytes: 900 },
    { path: "static/chunks/app.js", bytes: 400 },
  ]);
  assert.equal(buildSummaryLogs.length, 1);
  assert.deepEqual(JSON.parse(buildSummaryLogs[0]), buildSummary.summary);
  assert.equal(
    buildSummaryFs.calls.some(([operation]) => operation === "mkdir" || operation === "writeFile"),
    false,
  );

  const overBudgetFs = createFakeBuildOutputFs();
  const overBudgetLogs = [];
  const overBudget = await runBuildOutputCli({
    cwd: process.cwd(),
    env: {
      NEXT_DIST_DIR: ".next-behavior",
      BUNDLE_BASELINE_MAX_FILES: "4",
      BUNDLE_BASELINE_MAX_TOTAL_BYTES: "1600",
      BUNDLE_BASELINE_MAX_JS_BYTES: "1200",
      BUNDLE_BASELINE_MAX_SINGLE_JS_BYTES: "800",
      BUNDLE_BASELINE_MAX_CSS_BYTES: "99",
      BUNDLE_BASELINE_MAX_WASM_BYTES: "199",
    },
    argv: ["--summary-only"],
    fsApi: overBudgetFs.api,
    log: (value) => overBudgetLogs.push(value),
  });
  assert.equal(overBudget.exitCode, 1);
  assert.equal(overBudget.summary.status, "fail");
  assert.deepEqual(overBudget.budgetIssues, [
    "fileCount 5 > 4",
    "totalBytes 1650 > 1600",
    "jsBytes 1300 > 1200",
    "largestJsBytes 900 > 800",
    "cssBytes 100 > 99",
    "wasmBytes 200 > 199",
  ]);
  assert.deepEqual(JSON.parse(overBudgetLogs[0]).budgetIssues, overBudget.budgetIssues);
  assert.equal(
    overBudgetFs.calls.some(([operation]) => operation === "mkdir" || operation === "writeFile"),
    false,
  );

  for (const invalidBudget of ["0", "01", "+1", "1.0", "1e3", "9007199254740992"]) {
    assert.throws(
      () => parseBuildOutputConfig({
        cwd: process.cwd(),
        env: { BUNDLE_BASELINE_MAX_FILES: invalidBudget },
      }),
      /canonical positive integer/,
    );
  }
  assert.throws(
    () => parseBuildOutputConfig({ cwd: process.cwd(), env: { NEXT_DIST_DIR: "../outside" } }),
    /must resolve inside the project/,
  );
  assert.throws(
    () => parseBuildOutputConfig({ cwd: process.cwd(), env: { NEXT_DIST_DIR: "." } }),
    /must resolve inside the project/,
  );

  const fullBuildFs = createFakeBuildOutputFs();
  const fullBuildLogs = [];
  const fullBuild = await runBuildOutputCli({
    cwd: process.cwd(),
    env: {
      NEXT_DIST_DIR: ".next-behavior",
      BUNDLE_BASELINE_OUT: "artifacts/performance/build-output-behavior.json",
    },
    argv: [],
    fsApi: fullBuildFs.api,
    log: (value) => fullBuildLogs.push(value),
  });
  assert.equal(fullBuild.exitCode, 0);
  assert.equal(fullBuild.wroteArtifact, true);
  const mkdirCall = fullBuildFs.calls.find(([operation]) => operation === "mkdir");
  const writeCall = fullBuildFs.calls.find(([operation]) => operation === "writeFile");
  assert.ok(mkdirCall);
  assert.deepEqual(mkdirCall[2], { recursive: true });
  assert.ok(writeCall);
  assert.equal(writeCall[1], fullBuild.config.outputPath);
  assert.deepEqual(JSON.parse(writeCall[2]), fullBuild.report);
  assert.equal(writeCall[3], "utf8");
  assert.equal(fullBuildLogs.length, 2);
  assert.match(fullBuildLogs[1], /^Build output baseline written: /);

  const emptyBuildIdFs = createFakeBuildOutputFs({ buildId: "  " });
  await assert.rejects(
    () => runBuildOutputCli({
      cwd: process.cwd(),
      env: { NEXT_DIST_DIR: ".next-behavior" },
      argv: [],
      fsApi: emptyBuildIdFs.api,
      log: () => {},
    }),
    /BUILD_ID is empty/,
  );
  assert.equal(
    emptyBuildIdFs.calls.some(([operation]) => operation === "mkdir" || operation === "writeFile"),
    false,
  );

  assert.deepEqual(browserSmokeRequiredStepIssues(REQUIRED_BROWSER_SMOKE_STEPS), []);
  for (const omitted of REQUIRED_BROWSER_SMOKE_STEPS) {
    assert.deepEqual(
      browserSmokeRequiredStepIssues(REQUIRED_BROWSER_SMOKE_STEPS.filter((label) => label !== omitted)),
      [`missing browser smoke step: ${omitted}`],
    );
  }
  const stepLogs = [];
  let clock = 100;
  const stepRunner = createBrowserSmokeStepRunner({ now: () => clock++, log: (value) => stepLogs.push(value) });
  for (const label of REQUIRED_BROWSER_SMOKE_STEPS) {
    assert.equal(await stepRunner.run(label, async () => label), label);
  }
  assert.doesNotThrow(() => stepRunner.assertRequiredStepsComplete());
  assert.equal(stepLogs.length, REQUIRED_BROWSER_SMOKE_STEPS.length * 2);
  const incompleteRunner = createBrowserSmokeStepRunner({ log: () => {} });
  await incompleteRunner.run(REQUIRED_BROWSER_SMOKE_STEPS[0], async () => true);
  assert.throws(() => incompleteRunner.assertRequiredStepsComplete(), /missing browser smoke step/);

  let openAttempts = 0;
  let reloads = 0;
  let readyChecks = 0;
  const retryLogs = [];
  assert.equal(await openBrowserLoginModalWithSingleReload({
    label: "mobile",
    openModal: async () => ++openAttempts === 2,
    reload: async () => { reloads += 1; },
    expectReady: async () => { readyChecks += 1; },
    log: (value) => retryLogs.push(value),
  }), true);
  assert.deepEqual({ openAttempts, reloads, readyChecks }, { openAttempts: 2, reloads: 1, readyChecks: 1 });
  assert.deepEqual(retryLogs, ["WARN mobile login modal did not open; reloading once before retry"]);
  assertNoUnattendedBootstrapResolveRequests([]);
  assert.throws(() => assertNoUnattendedBootstrapResolveRequests([{ method: "POST" }]), /unattended bootstrap-resolve/);

  assert.equal(parseSmokeChainId(undefined), 59141);
  assert.equal(parseSmokeChainId("1"), 1);
  assert.equal(parseSmokeChainId("1000000000"), 1_000_000_000);
  for (const value of ["0", "01", "1.0", "1e3", "1000000001", "9007199254740992", " 1", "1 "]) {
    assert.throws(() => parseSmokeChainId(value), /NEXT_PUBLIC_LINEA_CHAIN_ID/);
  }

  assert.equal(parseBrowserSmokeContentLengthHeader(null), null);
  assert.equal(parseBrowserSmokeContentLengthHeader("0"), 0);
  assert.equal(parseBrowserSmokeContentLengthHeader(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of ["01", "+1", "1.0", "1e3", "9007199254740992", " 1"]) {
    assert.throws(() => parseBrowserSmokeContentLengthHeader(value), /invalid browser smoke response content-length/);
  }
  assert.deepEqual(
    await readBoundedBrowserSmokeJsonResponse(new Response('{"ok":true}', {
      headers: { "content-length": "11" },
    })),
    { ok: true },
  );
  await assert.rejects(
    readBoundedBrowserSmokeJsonResponse(new Response("{}", {
      headers: { "content-length": "262145" },
    })),
    /body too large/,
  );
  let oversizedReaderCancelled = false;
  const oversizedStream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(262_145));
    },
    cancel() { oversizedReaderCancelled = true; },
  });
  await assert.rejects(readBoundedBrowserSmokeJsonResponse(new Response(oversizedStream)), /body too large/);
  assert.equal(oversizedReaderCancelled, true);
  await assert.rejects(
    readBoundedBrowserSmokeJsonResponse(new Response(new Uint8Array([0xff]))),
    /encoded data was not valid|encoding/i,
  );
  await assert.rejects(readBoundedBrowserSmokeJsonResponse(new Response(null)), /body is empty/);
  await assert.rejects(readBoundedBrowserSmokeJsonResponse(new Response("not-json")), /JSON/);

  const probeSignal = { kind: "timeout-signal" };
  const probeCalls = [];
  const liveState = await fetchBrowserSmokeLiveState({
    baseUrl: "https://smoke.example",
    timeoutMs: 321,
    timeoutSignal: (ms) => {
      assert.equal(ms, 321);
      return probeSignal;
    },
    fetchImpl: async (url, options) => {
      probeCalls.push({ url: String(url), options });
      return new Response('{"currentEpoch":"42"}', {
        status: 200,
        headers: { "content-length": "21" },
      });
    },
  });
  assert.deepEqual(liveState, { currentEpoch: "42" });
  assert.deepEqual(probeCalls, [{
    url: "https://smoke.example/api/live-state",
    options: { cache: "no-store", signal: probeSignal },
  }]);
  await assert.rejects(
    fetchBrowserSmokeLiveState({
      baseUrl: "https://smoke.example",
      timeoutMs: 0,
      fetchImpl: async () => { throw new Error("fetch must not run"); },
    }),
    /positive safe integer/,
  );
  await assert.rejects(
    fetchBrowserSmokeLiveState({
      baseUrl: "https://smoke.example",
      timeoutMs: 10,
      timeoutSignal: () => probeSignal,
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    }),
    /live-state epoch probe returned 503/,
  );
  await assert.rejects(
    fetchBrowserSmokeLiveState({
      baseUrl: "https://smoke.example",
      timeoutMs: 10,
      timeoutSignal: () => probeSignal,
      fetchImpl: async () => new Response("{}", { headers: { "content-length": "262145" } }),
    }),
    /body too large/,
  );

  const pageHandlers = new Map();
  const initCalls = [];
  const contextOptions = [];
  const fakePage = {
    on(type, handler) { pageHandlers.set(type, handler); },
  };
  const fakeContext = {
    async addInitScript(script, argument) { initCalls.push({ script, argument }); },
    async newPage() { return fakePage; },
  };
  const fakeBrowser = {
    async newContext(options) {
      contextOptions.push(options);
      return fakeContext;
    },
  };
  const isolatedErrors = [];
  const isolatedConsoleErrors = [];
  const isolatedRegressions = [];
  const initScript = () => undefined;
  const isolated = await createIsolatedBrowserSmokePage({
    browser: fakeBrowser,
    viewport: { width: 390, height: 844 },
    initScript,
    initArgument: "tutorial-key",
    pageErrorSource: "mobile-wallet",
    consoleScope: "mobile-wallet",
    pageErrors: isolatedErrors,
    consoleErrors: isolatedConsoleErrors,
    consoleRegressions: isolatedRegressions,
  });
  assert.deepEqual(contextOptions, [{ viewport: { width: 390, height: 844 } }]);
  assert.deepEqual(initCalls, [{ script: initScript, argument: "tutorial-key" }]);
  assert.equal(isolated.context, fakeContext);
  assert.equal(isolated.page, fakePage);
  pageHandlers.get("pageerror")(new Error("PRIVATE_KEY=do-not-print"));
  assert.equal(isolatedErrors[0].source, "mobile-wallet");
  assert.doesNotMatch(isolatedErrors[0].message, /do-not-print/);
  pageHandlers.get("console")({ type: () => "error", text: () => "Invalid or unexpected token" });
  pageHandlers.get("console")({
    type: () => "warning",
    text: () => "Privy configured chains are not supported by Coinbase",
  });
  assert.equal(isolatedConsoleErrors.length, 1);
  assert.equal(isolatedRegressions.length, 1);

  const visibleCalls = [];
  const emptyVisual = { getAttribute: async () => "true" };
  const emptyPage = {
    locator(selector) {
      assert.equal(selector, '[data-testid="header-pool-chart-visual"]');
      return emptyVisual;
    },
  };
  assert.equal(await assertEmptyPoolChartVisual({
    page: emptyPage,
    expectVisible: async (...args) => { visibleCalls.push(args); },
    timeoutMs: 123,
  }), emptyVisual);
  assert.deepEqual(visibleCalls, [[emptyVisual, "empty pool chart visual", 123]]);
  await assert.rejects(
    assertEmptyPoolChartVisual({
      page: { locator: () => ({ getAttribute: async () => "false" }) },
      expectVisible: async () => undefined,
      timeoutMs: 123,
    }),
    /not marked as empty/,
  );

  let cliRuns = 0;
  assert.deepEqual(await runBrowserSmokeCli({
    mainFn: async () => { cliRuns += 1; },
    errorLog: () => {},
    processLike: { exitCode: 0 },
  }), { ok: true });
  assert.equal(cliRuns, 1);
  const cliErrors = [];
  const cliProcess = { exitCode: 0 };
  assert.deepEqual(await runBrowserSmokeCli({
    mainFn: async () => { throw new Error("PRIVATE_KEY=do-not-print"); },
    errorLog: (value) => cliErrors.push(value),
    processLike: cliProcess,
  }), { ok: false });
  assert.equal(cliProcess.exitCode, 1);
  assert.doesNotMatch(cliErrors[0], /do-not-print/);
  assert.match(cliErrors[0], /PRIVATE_KEY=<redacted>/);

  const sensitiveDiagnostic = compactBrowserDiagnostic(
    `request https://user:pass@example.test/private?token=abc ${"x".repeat(700)}`,
  );
  assert.ok(sensitiveDiagnostic.length <= MAX_BROWSER_SMOKE_DIAGNOSTIC_CHARS);
  assert.match(sensitiveDiagnostic, /<truncated>$/);
  assert.doesNotMatch(sensitiveDiagnostic, /user:pass|token=abc/);
  const compactError = compactPageError({
    message: "wallet https://user:pass@example.test/private",
    stack: "stack https://user:pass@example.test/private?token=abc",
  }, "mobile");
  assert.equal(compactError.source, "mobile");
  assert.doesNotMatch(`${compactError.message}\n${compactError.stack}`, /user:pass|token=abc/);
  assert.match(`${compactError.message}\n${compactError.stack}`, /<redacted>/);

  const ignoredConsole = classifyBrowserConsoleEvent({ type: "error", text: "[HMR] TypeError: Failed to fetch", scope: "mobile" });
  assert.equal(ignoredConsole.unexpectedError, false);
  assert.equal(ignoredConsole.connectorRegression, false);
  assert.match(ignoredConsole.diagnostic, /^\[mobile\]/);
  const connectorRegression = classifyBrowserConsoleEvent({
    type: "warning",
    text: "Privy configured chains are not supported by Coinbase",
  });
  assert.equal(connectorRegression.connectorRegression, true);
  assert.equal(connectorRegression.unexpectedError, false);
  const syntaxRegression = classifyBrowserConsoleEvent({ type: "error", text: "Invalid or unexpected token" });
  assert.equal(syntaxRegression.unexpectedError, true);
  assert.equal(syntaxRegression.connectorRegression, false);
  assert.equal(
    isIgnoredHydrationNoise("A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. caret-color:\"transparent\""),
    true,
  );
  assert.equal(isIgnoredHydrationNoise("A tree hydrated but syntax failed"), false);
  assert.equal(isIgnoredPageError("ChunkLoadError: Loading chunk app/layout failed"), true);
  assert.equal(isIgnoredPageError("Invalid or unexpected token"), false);

  const directHandlers = new Map();
  const directPageErrors = [];
  const directConsoleErrors = [];
  const directConsoleRegressions = [];
  installSmokePageObservers({
    page: { on: (type, handler) => directHandlers.set(type, handler) },
    pageErrorSource: "direct-mobile",
    consoleScope: "direct-mobile",
    pageErrors: directPageErrors,
    consoleErrors: directConsoleErrors,
    consoleRegressions: directConsoleRegressions,
    includeConsole: true,
  });
  assert.deepEqual([...directHandlers.keys()].sort(), ["console", "pageerror"]);
  directHandlers.get("pageerror")(new Error("PRIVATE_KEY=direct-observer-secret"));
  directHandlers.get("console")({ type: () => "error", text: () => "Invalid or unexpected token" });
  directHandlers.get("console")({
    type: () => "warning",
    text: () => "Privy configured chains are not supported by Coinbase",
  });
  assert.equal(directPageErrors[0].source, "direct-mobile");
  assert.doesNotMatch(directPageErrors[0].message, /direct-observer-secret/);
  assert.equal(directConsoleErrors.length, 1);
  assert.match(directConsoleErrors[0], /^\[direct-mobile\]/);
  assert.equal(directConsoleRegressions.length, 1);

  const errorOnlyHandlers = new Map();
  installSmokePageObservers({
    page: { on: (type, handler) => errorOnlyHandlers.set(type, handler) },
    pageErrorSource: "error-only",
    pageErrors: [],
  });
  assert.deepEqual([...errorOnlyHandlers.keys()], ["pageerror"]);

  let smokeEntrypointRuns = 0;
  assert.deepEqual(await runSmokeBrowserEntrypoint({
    mainFn: async () => { smokeEntrypointRuns += 1; },
    errorLog: () => {},
    processLike: { exitCode: 0 },
  }), { ok: true });
  assert.equal(smokeEntrypointRuns, 1, "the import-safe smoke entrypoint must invoke only its injected main");

  const config = parseBrowserBaselineConfig({
    BASELINE_BASE_URL: "http://127.0.0.1:3000/lab",
    BASELINE_OBSERVE_MS: "1000",
    BASELINE_SAMPLE_MS: "60000",
    BASELINE_VIEWPORT: "390x844",
  });
  assert.equal(config.baseUrl.origin, "http://127.0.0.1:3000");
  assert.deepEqual(config.viewport, { text: "390x844", width: 390, height: 844 });
  assert.equal(parseCanonicalInteger("9007199254740991", { fallback: 1, min: 1, max: Number.MAX_SAFE_INTEGER, name: "probe" }), Number.MAX_SAFE_INTEGER);
  for (const mutant of [
    "https://example.com:3000",
    "http://localhost.example.com:3000",
    "http://user:pass@localhost:3000",
    " http://localhost:3000",
    "http://localhost:3000?token=secret",
  ]) assert.throws(() => parseLoopbackBaselineUrl(mutant), /loopback URL/);
  for (const mutant of ["01", "+1", "1e3", " 1000", "1000 "]) {
    assert.throws(
      () => parseCanonicalInteger(mutant, { fallback: 1, min: 1, max: 2_000, name: "probe" }),
      /canonical decimal integer/,
    );
  }
  assert.equal(isBaselineLocalTarget("http://localhost:3000/api/x", config.baseUrl), true);
  assert.equal(isBaselineLocalTarget("https://localhost:3000/api/x", config.baseUrl), false);

  const sanitized = sanitizeBaselineDiagnostic(`RPC_URL=https://rpc.example/key ${"x".repeat(700)}`);
  assert.ok(sanitized.length <= 500);
  assert.doesNotMatch(sanitized, /rpc\.example|x{500}/);
  assert.match(sanitized, /<truncated>/);
  const unknown = classifyBaselineConsoleError({ message: "hydration failed", locationUrl: "" }, config.baseUrl);
  assert.deepEqual({ kind: unknown.kind, target: unknown.target }, { kind: "react", target: "unknown" });
  assert.equal(deriveBaselineQuality({ consoleErrorsByTarget: { unknown: 1 } }).status, "degraded");
  assert.equal(deriveBaselineQuality({ consoleErrorsByTarget: { external: 1 } }).status, "pass");

  const abortBase = "http://localhost:3000/";
  const abort = (overrides) => classifyExpectedBaselineAbort({
    url: "http://127.0.0.1:3000/api/chat/messages",
    method: "GET",
    resourceType: "fetch",
    headers: {},
    error: "net::ERR_ABORTED",
    ...overrides,
  }, abortBase);
  assert.equal(abort({}), "chat-poll");
  assert.equal(abort({ url: "http://localhost:3000/api/recent-wins" }), "recent-wins-poll");
  assert.equal(abort({ url: "http://localhost:3000/?_rsc=abc" }), "rsc");
  assert.equal(abort({ url: "http://localhost:3000/", method: "HEAD" }), "wallet-coop");
  for (const mutant of [
    { url: "http://localhost:3000/api/chat/messages?cursor=1" },
    { resourceType: "xhr" },
    { method: "POST" },
    { error: "net::ERR_FAILED" },
    { url: "http://example.com/api/chat/messages" },
  ]) assert.equal(abort(mutant), null);

  const latency = new Map();
  for (let value = 1; value <= 140; value += 1) addBoundedLatencySample(latency, "/api/live-state", value);
  assert.equal(latency.get("/api/live-state").length, MAX_API_LATENCY_SAMPLES_PER_PATH);
  assert.equal(addBoundedLatencySample(latency, "/api/invalid", -1), false);
  assert.deepEqual(summarizeLatencySamples([1, 2, 3, 4, 100]), {
    samples: 5, minMs: 1, meanMs: 22, p95Ms: 100, maxMs: 100,
  });

  const report = sampleReport();
  const summaryPublication = planBrowserBaselinePublication(report, { summaryOnly: true });
  assert.equal(summaryPublication.shouldWriteArtifact, false);
  assert.equal(summaryPublication.artifactText, null);
  assert.doesNotMatch(summaryPublication.consoleText, /requestFailureSamples|consoleErrorSamples|"samples": \[/);
  const filePublication = planBrowserBaselinePublication(report, { summaryOnly: false });
  assert.equal(filePublication.shouldWriteArtifact, true);
  assert.ok(filePublication.artifactText.endsWith("\n"));
  assert.deepEqual(JSON.parse(filePublication.artifactText), report);

  let collectorCalls = 0;
  const collectReport = async ({ baselineConfig }) => {
    collectorCalls += 1;
    assert.equal(baselineConfig.baseUrl.href, "http://127.0.0.1:3000/lab");
    assert.equal(baselineConfig.observeMs, 1_000);
    return report;
  };
  const summaryLogs = [];
  const noWriteFs = {
    async mkdir() { throw new Error("summary mode must not create an artifact directory"); },
    async writeFile() { throw new Error("summary mode must not write an artifact"); },
  };
  const summaryResult = await runBrowserBaselineCli({
    env: {
      BASELINE_BASE_URL: "http://127.0.0.1:3000/lab",
      BASELINE_OBSERVE_MS: "1000",
      BASELINE_SAMPLE_MS: "1000",
      BASELINE_VIEWPORT: "390x844",
      BASELINE_OUT: "ignored-summary.json",
    },
    argv: ["--summary-only"],
    cwd: process.cwd(),
    collectBrowserBaselineFn: collectReport,
    fsApi: noWriteFs,
    log: (value) => summaryLogs.push(value),
  });
  assert.equal(collectorCalls, 1, "the real CLI binding must invoke the injected browser collector once");
  assert.equal(summaryResult.publication.shouldWriteArtifact, false);
  assert.equal(summaryLogs.length, 1);
  assert.doesNotMatch(summaryLogs[0], /requestFailureSamples|consoleErrorSamples|private|\/secret/);

  let invalidUrlCollectorCalls = 0;
  await assert.rejects(
    () => runBrowserBaselineCli({
      env: { BASELINE_BASE_URL: "https://example.com" },
      argv: ["--summary-only"],
      collectBrowserBaselineFn: async () => { invalidUrlCollectorCalls += 1; return report; },
      fsApi: noWriteFs,
      log: () => {},
    }),
    /loopback URL/,
  );
  assert.equal(invalidUrlCollectorCalls, 0, "URL validation must run before browser collection");

  const artifactCalls = [];
  const artifactLogs = [];
  const artifactResult = await runBrowserBaselineCli({
    env: { BASELINE_OUT: "artifacts/test-browser-binding.json" },
    argv: [],
    cwd: process.cwd(),
    collectBrowserBaselineFn: async () => report,
    fsApi: {
      async mkdir(directory, options) { artifactCalls.push(["mkdir", directory, options]); },
      async writeFile(file, text, encoding) { artifactCalls.push(["writeFile", file, text, encoding]); },
    },
    log: (value) => artifactLogs.push(value),
  });
  assert.equal(artifactResult.publication.shouldWriteArtifact, true);
  assert.equal(artifactCalls.length, 2);
  assert.equal(artifactCalls[0][0], "mkdir");
  assert.deepEqual(artifactCalls[0][2], { recursive: true });
  assert.equal(artifactCalls[1][0], "writeFile");
  assert.equal(artifactCalls[1][1], artifactResult.outputPath);
  assert.deepEqual(JSON.parse(artifactCalls[1][2]), report);
  assert.equal(artifactCalls[1][3], "utf8");
  assert.equal(artifactLogs.length, 2);
  assert.match(artifactLogs[1], /^Browser baseline written: /);

  const collectorFailure = new Error("synthetic collector failure");
  let failureIoCalls = 0;
  await assert.rejects(
    () => runBrowserBaselineCli({
      env: {},
      argv: [],
      collectBrowserBaselineFn: async () => { throw collectorFailure; },
      fsApi: {
        async mkdir() { failureIoCalls += 1; },
        async writeFile() { failureIoCalls += 1; },
      },
      log: () => { failureIoCalls += 1; },
    }),
    (error) => error === collectorFailure,
  );
  assert.equal(failureIoCalls, 0, "collector failures must not publish partial evidence");

  const observed = [];
  const scope = {
    PerformanceObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(options) { observed.push({ callback: this.callback, options }); }
    },
  };
  installBrowserBaselineObservers(scope);
  const eventObserver = observed.find(({ options }) => options.type === "event");
  assert.deepEqual(eventObserver.options, { type: "event", buffered: true, durationThreshold: 16 });
  eventObserver.callback({ getEntries: () => [
    { interactionId: 0, duration: 200, name: "ignored" },
    { interactionId: 7, duration: 48, name: "click" },
    { interactionId: 8, duration: 20, name: "keydown" },
  ] });
  assert.deepEqual(
    { inp: scope.__lorePerformanceBaseline.inp, event: scope.__lorePerformanceBaseline.inpEvent },
    { inp: 48, event: "click" },
  );
  let soundClicks = 0;
  assert.equal(await triggerSyntheticSoundToggle({
    getByRole: () => ({ isVisible: async () => true, click: async () => { soundClicks += 1; } }),
  }), true);
  assert.equal(soundClicks, 1);
  assert.equal(await triggerSyntheticSoundToggle({
    getByRole: () => ({ isVisible: async () => false, click: async () => { throw new Error("must not click"); } }),
  }), false);

  const page = createFakeBrowserPage();
  assert.equal(await openLoginModal(page, 20_000), true);
  assert.equal(page.state.modalOpen, true);
  assert.ok(page.state.keyPresses.includes("Escape"), "disabled primary login must exercise the fallback callback");
  assert.equal(await openWalletSelectorFromLoginModal(page, 20_000), true);
  assert.equal(page.state.walletAttempt, 2, "wallet options must exercise the retry callback");
  assert.ok(page.state.waitCalls >= 8, "real flows callbacks must execute through the fake DOM");

  await verifyVisibleTouchTargets(page, "fake hub");
  page.touchTargets[0].rect.width = 43;
  await assert.rejects(() => verifyVisibleTouchTargets(page, "mutant hub"), /below 44px/);
  page.touchTargets[0].rect.width = 44;
  await verifyReadOnlyMode(page, 6_000);
  page.manualAction.disabled = false;
  await assert.rejects(() => verifyReadOnlyMode(page, 6_000), /Timeout/);
  page.manualAction.disabled = true;
  await verifyHubVisualRegressionGuards(page, 6_000);
  page.chartPath.attributes.set("d", "");
  await assert.rejects(() => verifyHubVisualRegressionGuards(page, 6_000), /Timeout/);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBrowserToolingBehaviorTests();
  console.log("Browser tooling behavioral tests passed.");
}
