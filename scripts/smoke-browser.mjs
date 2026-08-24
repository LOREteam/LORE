import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";
import {
  classifyBrowserConsoleEvent,
  compactPageError,
  assertEmptyPoolChartVisual,
  assertNoUnattendedBootstrapResolveRequests,
  createIsolatedBrowserSmokePage,
  createBrowserSmokeStepRunner,
  fetchBrowserSmokeLiveState,
  isIgnoredHydrationNoise,
  isIgnoredPageError,
  openBrowserLoginModalWithSingleReload,
  parseSmokeChainId,
  runBrowserSmokeCli,
} from "./smoke-browser-policy.mjs";
import {
  ensureLandingPage,
  expectVisible,
  findExecutablePath,
  saveSmokeScreenshot,
  safeReload,
  warmBaseUrl,
} from "./smoke-browser-lib/core.mjs";
import {
  closeChatDrawer,
  closeLoginModal,
  openChatDrawer,
  openDesktopTab,
  openLoginModal,
  openMobileAnalytics,
  openWalletSelectorFromLoginModal,
  selectSingleTile,
  verifyAutoMinerFailureScenarios,
  verifyPendingBetReloadRecovery,
  verifyHubVisualRegressionGuards,
  verifyMobileHubResponsiveGuards,
  verifyVisibleTouchTargets,
  verifyAutoMinerInputPersistence,
  verifyChatProfileModal,
  verifyReadOnlyMode,
} from "./smoke-browser-lib/flows.mjs";

const directEntryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
const directExecution = import.meta.url === directEntryUrl;
if (directExecution) await import("dotenv/config");

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts", "smoke-browser");
const SCREENSHOT_PATH = path.resolve(process.env.SMOKE_BROWSER_SCREENSHOT_PATH || path.join(OUTPUT_DIR, "latest-home.local.png"));
const TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_BROWSER_TIMEOUT_MS, 45_000);
const WARMUP_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_BROWSER_WARMUP_TIMEOUT_MS, 90_000);
const TILE_SELECTION_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_TILE_SELECTION_TIMEOUT_MS, 45_000);
const LIVE_STATE_PROBE_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_LIVE_STATE_PROBE_TIMEOUT_MS, 15_000);
const SMOKE_CHAIN_ID = parseSmokeChainId(process.env.NEXT_PUBLIC_LINEA_CHAIN_ID);
const LEGACY_AUTO_MINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";
const AUTO_MINER_INPUTS_KEY = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
  ? `lineaore:auto-miner-inputs:v2:${SMOKE_CHAIN_ID}:${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS.toLowerCase()}`
  : LEGACY_AUTO_MINER_INPUTS_KEY;
const AUTO_MINE_DEBUG_OVERRIDE_KEY = "lineaore:auto-mine-debug-override:v1";
const PENDING_MINING_TX_KEY = "lineaore:pending-mining-tx:v1";
const FIRST_VISIT_TUTORIAL_KEY = "lore:first-visit-tutorial:v1";

const INCLUDE_DEBUG_AUTOMINER_SCENARIOS = process.env.SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS === "1";
const ONLY_PENDING_RECOVERY = process.env.SMOKE_ONLY_PENDING_RECOVERY === "1";
const EXPECT_READ_ONLY = process.env.SMOKE_EXPECT_READ_ONLY === "1";

const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER_EXECUTABLE,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const browserSmokeSteps = createBrowserSmokeStepRunner();
const runStep = browserSmokeSteps.run;

export function installSmokePageObservers({
  page,
  pageErrorSource,
  consoleScope,
  pageErrors,
  consoleErrors,
  consoleRegressions,
  includeConsole = false,
}) {
  page.on("pageerror", (error) => pageErrors.push(compactPageError(error, pageErrorSource)));
  if (!includeConsole) return;
  page.on("console", (message) => {
    const classified = classifyBrowserConsoleEvent({
      type: message.type(),
      text: message.text(),
      scope: consoleScope,
    });
    if (classified.connectorRegression) consoleRegressions.push(classified.diagnostic);
    if (classified.unexpectedError) consoleErrors.push(classified.diagnostic);
  });
}

async function verifyNativeWebLocksAcrossTabs(context) {
  const owner = await context.newPage();
  const contender = await context.newPage();
  const lockName = `lore-smoke-web-lock:${Date.now()}`;

  try {
    await Promise.all([
      owner.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS }),
      contender.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS }),
    ]);
    const ownerAcquired = await owner.evaluate(async (name) => {
      if (!navigator.locks) return false;
      let resolveReady;
      const ready = new Promise((resolve) => {
        resolveReady = resolve;
      });
      const hold = new Promise((resolve) => {
        window.__loreSmokeReleaseWebLock = resolve;
      });
      void navigator.locks.request(name, { ifAvailable: true, mode: "exclusive" }, async (lock) => {
        resolveReady(Boolean(lock));
        if (lock) await hold;
      });
      return ready;
    }, lockName);
    if (!ownerAcquired) throw new Error("browser does not provide an exclusive Web Lock to the owner tab");

    const contenderBlocked = await contender.evaluate(async (name) => {
      if (!navigator.locks) return false;
      return navigator.locks.request(name, { ifAvailable: true, mode: "exclusive" }, (lock) => !lock);
    }, lockName);
    if (!contenderBlocked) throw new Error("second tab acquired an Auto-Miner-style Web Lock while the owner held it");

    await owner.evaluate(() => {
      window.__loreSmokeReleaseWebLock?.();
      delete window.__loreSmokeReleaseWebLock;
    });
    const contenderAcquiredAfterRelease = await contender.evaluate(async (name) => {
      if (!navigator.locks) return false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const acquired = await navigator.locks.request(
          name,
          { ifAvailable: true, mode: "exclusive" },
          (lock) => Boolean(lock),
        );
        if (acquired) return true;
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
      return false;
    }, lockName);
    if (!contenderAcquiredAfterRelease) {
      throw new Error("second tab could not acquire the Web Lock after the owner released it");
    }
    console.log("PASS native Web Locks exclude a second tab and release cleanly");
  } finally {
    await Promise.allSettled([owner.close(), contender.close()]);
  }
}

async function openLoginModalWithReload(page, options, label) {
  return openBrowserLoginModalWithSingleReload({
    label,
    openModal: () => openLoginModal(page, options.timeoutMs),
    reload: () => safeReload(page, options.baseUrl, options.timeoutMs),
    expectReady: () => expectVisible(page.getByText("Manual Bet", { exact: true }), `${label} manual bet panel after login reload`, options.timeoutMs),
  });
}

async function verifyViewportShell(browser, viewport, label, smokeOptions, pageErrors) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((tutorialKey) => {
    window.localStorage.setItem(tutorialKey, "1");
  }, FIRST_VISIT_TUTORIAL_KEY);
  const page = await context.newPage();
  installSmokePageObservers({ page, pageErrorSource: label, pageErrors });
  await ensureLandingPage(page, smokeOptions);
  const layout = await page.evaluate(() => {
    const selectors = [
      "main",
      "header",
      ".control-panel-manual",
      ".control-panel-auto",
    ];
    const missing = selectors.filter((selector) => !document.querySelector(selector));
    const outsideViewport = selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return [];
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > window.innerWidth + 1
        ? [{ selector, left: rect.left, right: rect.right }]
        : [];
    });
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      missing,
      outsideViewport,
    };
  });
  await context.close();
  if (layout.horizontalOverflow > 1 || layout.missing.length > 0 || layout.outsideViewport.length > 0) {
    throw new Error(`${label} layout failed: ${JSON.stringify(layout)}`);
  }
  console.log(`PASS ${label} shell stays inside the viewport`);
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const executablePath = await findExecutablePath(BROWSER_CANDIDATES);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });

  const pageErrors = [];
  const consoleErrors = [];
  const consoleRegressions = [];
  const bootstrapResolveRequests = [];
  const smokeOptions = {
    autoMineDebugOverrideKey: AUTO_MINE_DEBUG_OVERRIDE_KEY,
    autoMinerInputsKey: AUTO_MINER_INPUTS_KEY,
    baseUrl: BASE_URL,
    chainId: SMOKE_CHAIN_ID,
    contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
    pendingMiningTxKey: PENDING_MINING_TX_KEY,
    tileSelectionTimeoutMs: TILE_SELECTION_TIMEOUT_MS,
    timeoutMs: TIMEOUT_MS,
  };

  try {
    await runStep(`warm ${BASE_URL}`, () => warmBaseUrl(BASE_URL, WARMUP_TIMEOUT_MS));

    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await desktopContext.newPage();
    await page.addInitScript((tutorialKey) => {
      try {
        window.localStorage.setItem(tutorialKey, "1");
      } catch {
        // ignore storage failures in smoke
      }
    }, FIRST_VISIT_TUTORIAL_KEY);
    installSmokePageObservers({
      page,
      pageErrorSource: "desktop",
      pageErrors,
      consoleErrors,
      consoleRegressions,
      includeConsole: true,
    });
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (request.method() === "POST" && requestUrl.pathname === "/api/bootstrap-resolve") {
        bootstrapResolveRequests.push(requestUrl.pathname);
      }
    });

    console.log(`Browser smoke URL: ${BASE_URL}`);
    await runStep("open desktop landing page", () => ensureLandingPage(page, smokeOptions));
    await runStep("verify browser boot does not trigger keeper resolve", async () => {
      assertNoUnattendedBootstrapResolveRequests(bootstrapResolveRequests);
    });
    await runStep("verify native Web Locks across two tabs", () => verifyNativeWebLocksAcrossTabs(desktopContext));

    await runStep("assert desktop hub shell", async () => {
      await expectVisible(page.getByRole("button", { name: "Mining Hub" }), "hub nav", TIMEOUT_MS);
      const sidebar = page.locator("aside").first();
      await expectVisible(sidebar.getByText("Hot Tiles", { exact: true }), "sidebar hot tiles", TIMEOUT_MS);
      await expectVisible(sidebar.getByText("Most wins - last 40 rounds", { exact: true }), "sidebar hot tiles subtitle", TIMEOUT_MS);
      await expectVisible(page.getByText("Manual Bet", { exact: true }), "hub manual bet panel", TIMEOUT_MS);
      await expectVisible(page.getByText("Auto-Miner"), "hub auto-miner panel", TIMEOUT_MS);
      await expectVisible(page.getByRole("button", { name: /Login or connect wallet|Wallet Loading/i }), "connect wallet button", TIMEOUT_MS);
      await saveSmokeScreenshot(page, SCREENSHOT_PATH);
    });
    await runStep("verify hub visual regression guards", () => verifyHubVisualRegressionGuards(page, TIMEOUT_MS));
    if (ONLY_PENDING_RECOVERY) {
      await runStep("verify pending bet reload recovery", () => verifyPendingBetReloadRecovery(page, smokeOptions));
      console.log("\nPending bet reload/reopen smoke passed.");
      return;
    }

    await runStep("verify tablet viewport", () => verifyViewportShell(
      browser,
      { width: 768, height: 1024 },
      "768px tablet",
      smokeOptions,
      pageErrors,
    ));
    await runStep("verify wide desktop viewport", () => verifyViewportShell(
      browser,
      { width: 1920, height: 1080 },
      "1920px desktop",
      smokeOptions,
      pageErrors,
    ));
    await runStep("verify keyboard focus indicator", async () => {
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      let focused = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await page.keyboard.press("Tab");
        focused = await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement) || element === document.body) return null;
          const rect = element.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return null;
          const style = window.getComputedStyle(element);
          return {
            label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 40) || element.tagName,
            visibleIndicator: element.matches(":focus-visible")
              && (style.outlineStyle !== "none" || style.boxShadow !== "none"),
          };
        });
        if (focused?.visibleIndicator) break;
      }
      if (!focused?.visibleIndicator) {
        throw new Error(`keyboard focus indicator missing${focused?.label ? ` on ${focused.label}` : ""}`);
      }
    });
    await runStep("verify visible controls have accessible names", async () => {
      const unnamed = await page.evaluate(() => {
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const accessibleName = (element) => {
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledText = labelledBy
            ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")
            : "";
          const associatedLabel = element.id
            ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent ?? ""
            : "";
          return [
            element.getAttribute("aria-label"),
            labelledText,
            associatedLabel,
            element.getAttribute("title"),
            element.textContent,
            element.querySelector("img[alt]")?.getAttribute("alt"),
          ].find((value) => value?.trim());
        };
        return [...document.querySelectorAll("button, a[href], input, select, textarea")]
          .filter((element) => element instanceof HTMLElement && isVisible(element) && !accessibleName(element))
          .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${[...element.classList].slice(0, 2).join(".")}`)
          .slice(0, 10);
      });
      if (unnamed.length > 0) throw new Error(`visible controls without accessible names: ${unnamed.join(", ")}`);
      console.log("PASS visible interactive controls have accessible names");
    });
    await runStep("verify named main landmark", async () => {
      const label = await page.locator("main").getAttribute("aria-label");
      if (!label?.trim()) throw new Error("main landmark is missing an accessible name");
    });
    await runStep("verify system reduced-motion preference", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("html[data-motion='reduced']").waitFor({ state: "attached", timeout: TIMEOUT_MS });
      const reducedAnimation = await page.evaluate(() => {
        const animated = document.querySelector(".animate-pulse, .animate-fade-in, .animate-slide-up");
        return animated ? window.getComputedStyle(animated).animationDuration : null;
      });
      const reducedAnimationSeconds = reducedAnimation
        ? Number.parseFloat(reducedAnimation) / (reducedAnimation.endsWith("ms") ? 1000 : 1)
        : 0;
      if (!Number.isFinite(reducedAnimationSeconds) || reducedAnimationSeconds > 0.00001) {
        throw new Error(`reduced-motion animation duration is ${reducedAnimation}`);
      }
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.locator("html[data-motion='reduced']").waitFor({ state: "detached", timeout: TIMEOUT_MS });
    });
    if (EXPECT_READ_ONLY) {
      await runStep("verify read-only betting mode", () => verifyReadOnlyMode(page, TIMEOUT_MS));
    }
    await runStep("verify desktop wallet selector", async () => {
      const loginModalOpened = await openLoginModalWithReload(page, smokeOptions, "desktop");
      if (!loginModalOpened) {
        throw new Error("desktop login modal did not open during mandatory wallet selector smoke");
      }
      await openWalletSelectorFromLoginModal(page, TIMEOUT_MS);
      await closeLoginModal(page, TIMEOUT_MS);
    });

    const { context: mobileWalletContext, page: mobileWalletPage } = await createIsolatedBrowserSmokePage({
      browser,
      viewport: { width: 390, height: 844 },
      initScript: (tutorialKey) => {
        try {
          window.localStorage.setItem(tutorialKey, "1");
        } catch {
          // ignore storage failures in smoke
        }
      },
      initArgument: FIRST_VISIT_TUTORIAL_KEY,
      pageErrorSource: "mobile-wallet",
      consoleScope: "mobile-wallet",
      pageErrors,
      consoleErrors,
      consoleRegressions,
    });
    await runStep("open isolated mobile wallet page", () => ensureLandingPage(mobileWalletPage, smokeOptions));
    await runStep("verify isolated mobile wallet selector", async () => {
      await expectVisible(mobileWalletPage.getByRole("button", { name: "Hub" }), "isolated mobile hub nav", TIMEOUT_MS);
      await expectVisible(mobileWalletPage.getByText("Manual Bet", { exact: true }), "isolated mobile manual bet panel", TIMEOUT_MS);
      const mobileLoginModalOpened = await openLoginModalWithReload(mobileWalletPage, smokeOptions, "isolated mobile");
      if (!mobileLoginModalOpened) {
        throw new Error("isolated mobile login modal did not open during mandatory wallet selector smoke");
      }
      await openWalletSelectorFromLoginModal(mobileWalletPage, TIMEOUT_MS);
      await closeLoginModal(mobileWalletPage, TIMEOUT_MS);
    });
    await mobileWalletContext.close();

    const tutorialContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await tutorialContext.addInitScript(() => {
      const userAgent = navigator.userAgent.replace(/Headless/g, "");
      Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
      Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => userAgent });
    });
    const tutorialPage = await tutorialContext.newPage();
    installSmokePageObservers({ page: tutorialPage, pageErrorSource: "tutorial", pageErrors });
    await runStep("verify first-visit tutorial accessibility", async () => {
      await ensureLandingPage(tutorialPage, smokeOptions);
      const tutorialDialog = tutorialPage.getByRole("dialog", { name: "First visit tutorial" });
      await expectVisible(tutorialDialog, "first-visit tutorial dialog", TIMEOUT_MS);
      await verifyVisibleTouchTargets(tutorialPage, "first-visit tutorial");
      await tutorialPage.keyboard.press("Escape");
      await tutorialDialog.waitFor({ state: "detached", timeout: TIMEOUT_MS });
    });
    await tutorialContext.close();

    if (EXPECT_READ_ONLY) {
      console.log("SKIP auto-miner persistence step in read-only smoke");
    } else {
      await runStep("verify auto-miner persistence", () => verifyAutoMinerInputPersistence(page, smokeOptions));
    }
    if (EXPECT_READ_ONLY) {
      console.log("SKIP auto-miner failure scenarios step in read-only smoke");
    } else if (INCLUDE_DEBUG_AUTOMINER_SCENARIOS) {
      await runStep("verify auto-miner failure scenarios", () => verifyAutoMinerFailureScenarios(page, smokeOptions));
      await runStep("verify pending bet reload recovery", () => verifyPendingBetReloadRecovery(page, smokeOptions));
    } else {
      console.log("SKIP auto-miner failure scenarios step (set SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS=1 to enable)");
    }

    if (EXPECT_READ_ONLY) {
      console.log("SKIP tile selection step in read-only smoke");
    } else {
      const tileSelectionOk = await runStep("select single tile", () => selectSingleTile(page, smokeOptions));
      if (!tileSelectionOk) {
        throw new Error("tile selection smoke did not reach an interactive or valid closed-epoch state");
      }
    }

    const chatOpened = await runStep("open chat drawer", () => openChatDrawer(page, smokeOptions));
    if (chatOpened) {
      await runStep("verify chat profile modal", () => verifyChatProfileModal(page, TIMEOUT_MS));
      await runStep("close chat drawer", () => closeChatDrawer(page, smokeOptions));
    }

    await runStep("open desktop analytics tab", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "Analytics",
      checks: [
        [page.getByText("Achievements"), "analytics tab"],
        [page.getByRole("heading", { name: "My Deposits" }), "analytics deposits panel"],
      ],
      skipMessage: "analytics tab did not open during smoke window",
    }));

    await runStep("open desktop safety pool tab", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "Safety Pool",
      targetHash: "#rebate",
      checks: [[page.getByRole("heading", { name: "Safety Pool" }).first(), "safety pool tab"]],
      skipMessage: "Safety Pool tab did not open during smoke window",
    }));

    await runStep("open desktop leaderboards tab", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "Leaderboards",
      checks: [[page.getByRole("heading", { name: "Leaderboards" }), "leaderboards tab"]],
      skipMessage: "leaderboards tab did not open during smoke window",
    }));

    await runStep("open desktop white paper tab", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "White Paper",
      checks: [
        [page.getByText("Introduction"), "whitepaper tab"],
        [page.getByText("Tokenomics & Fee Split"), "whitepaper tokenomics section"],
        [page.getByText("Transparent Play"), "whitepaper transparent play section"],
        [page.getByText("Winning outcomes are probabilistic and are not guaranteed"), "whitepaper risk disclosure"],
      ],
      skipMessage: "white paper tab did not open during smoke window",
    }));

    await runStep("open desktop faq tab", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "FAQ",
      checks: [[page.getByText("I just opened the site. What do I do first?"), "faq tab"]],
      skipMessage: "faq tab did not open during smoke window",
    }));

    await runStep("return to desktop hub", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "Mining Hub",
      checks: [
        [page.getByText("Manual Bet", { exact: true }), "return to hub"],
        [page.getByText("Auto-Miner"), "hub auto-miner panel after return"],
      ],
      skipMessage: "hub tab did not open during smoke window",
    }));
    await page.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mobileContext.addInitScript((tutorialKey) => {
      try {
        window.localStorage.setItem(tutorialKey, "1");
      } catch {
        // ignore storage failures in smoke
      }
    }, FIRST_VISIT_TUTORIAL_KEY);
    const mobilePage = await mobileContext.newPage();
    installSmokePageObservers({
      page: mobilePage,
      pageErrorSource: "mobile",
      consoleScope: "mobile",
      pageErrors,
      consoleErrors,
      consoleRegressions,
      includeConsole: true,
    });

    await runStep("open mobile landing page", () => ensureLandingPage(mobilePage, smokeOptions));
    await runStep("assert mobile hub shell", async () => {
      await expectVisible(mobilePage.getByRole("button", { name: "Hub" }), "mobile hub nav", TIMEOUT_MS);
      await expectVisible(mobilePage.getByRole("button", { name: "Leaderboards" }), "mobile top nav", TIMEOUT_MS);
      await expectVisible(mobilePage.getByText("Manual Bet", { exact: true }), "mobile manual bet panel", TIMEOUT_MS);
      await expectVisible(mobilePage.getByText("Auto-Miner"), "mobile auto-miner panel", TIMEOUT_MS);
    });
    await runStep("verify mobile touch targets", () => verifyVisibleTouchTargets(mobilePage, "mobile hub"));
    await runStep("verify 430px mobile hub guards", async () => {
      await mobilePage.setViewportSize({ width: 430, height: 932 });
      await verifyMobileHubResponsiveGuards(mobilePage, TIMEOUT_MS);
      await mobilePage.setViewportSize({ width: 390, height: 844 });
    });
    const mobileChatOpened = await runStep("verify mobile chat keyboard viewport", () => openChatDrawer(mobilePage, smokeOptions));
    if (mobileChatOpened) {
      await mobilePage.setViewportSize({ width: 390, height: 520 });
      const chatFooter = mobilePage.getByText("Connect wallet to chat");
      await chatFooter.scrollIntoViewIfNeeded();
      const mobileChatLayout = await mobilePage.evaluate(() => {
        const footer = [...document.querySelectorAll("div")].find((element) => element.textContent?.trim() === "Connect wallet to chat");
        if (!(footer instanceof HTMLElement)) return null;
        const rect = footer.getBoundingClientRect();
        return {
          footerTop: rect.top,
          footerBottom: rect.bottom,
          viewportHeight: window.innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      if (!mobileChatLayout || mobileChatLayout.footerTop < 0 || mobileChatLayout.footerBottom > mobileChatLayout.viewportHeight + 1) {
        throw new Error(`mobile chat footer is obscured after viewport shrink: ${JSON.stringify(mobileChatLayout)}`);
      }
      if (mobileChatLayout.horizontalOverflow > 1) {
        throw new Error(`mobile chat horizontal overflow after viewport shrink: ${mobileChatLayout.horizontalOverflow}px`);
      }
      await closeChatDrawer(mobilePage, smokeOptions);
      await mobilePage.setViewportSize({ width: 390, height: 844 });
    }
    await runStep("open mobile analytics", () => openMobileAnalytics(mobilePage, smokeOptions));
    const mobileSafetyPoolOpened = await runStep("open mobile safety pool", () => openDesktopTab(mobilePage, {
      ...smokeOptions,
      buttonName: "Safety Pool",
      targetHash: "#rebate",
      checks: [[mobilePage.getByRole("heading", { name: "Safety Pool" }).first(), "mobile safety pool tab"]],
      skipMessage: "mobile Safety Pool tab did not open during smoke window",
    }));
    if (mobileSafetyPoolOpened) {
      await runStep("verify mobile safety pool touch targets", () => verifyVisibleTouchTargets(mobilePage, "mobile safety pool"));
    }
    const mobileLeaderboardsOpened = await runStep("open mobile leaderboards", () => openDesktopTab(mobilePage, {
      ...smokeOptions,
      buttonName: "Leaderboards",
      checks: [[mobilePage.getByRole("heading", { name: "Leaderboards" }).first(), "mobile leaderboards tab"]],
      skipMessage: "mobile Leaderboards tab did not open during smoke window",
    }));
    if (mobileLeaderboardsOpened) {
      await runStep("verify mobile leaderboards touch targets", () => verifyVisibleTouchTargets(mobilePage, "mobile leaderboards"));
    }
    const authoritativeEpochText = (await mobilePage.locator('[data-testid="header-epoch-value"]').textContent())?.trim();
    const authoritativeEpochMatch = /^#([1-9]\d*)$/.exec(authoritativeEpochText ?? "");
    if (!authoritativeEpochMatch) {
      throw new Error(`could not bind extreme-value fixture to the authoritative epoch: ${authoritativeEpochText ?? "missing"}`);
    }
    const authoritativeEpoch = authoritativeEpochMatch[1];
    await mobileContext.close();

    await runStep("verify 360px extreme-value overflow", async () => {
      const hugeEpoch = "123456789012345678901234";
      const hugeWei = "123456789012345678901234567890123456789012345678";
      const stressContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
      await stressContext.addInitScript((tutorialKey) => {
        window.localStorage.setItem(tutorialKey, "1");
      }, FIRST_VISIT_TUTORIAL_KEY);
      const stressPage = await stressContext.newPage();
      installSmokePageObservers({ page: stressPage, pageErrorSource: "extreme-values", pageErrors });
      let stressLiveStateRequestCount = 0;
      await stressPage.route("**/api/live-state", (route) => {
        stressLiveStateRequestCount += 1;
        return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          currentEpoch: authoritativeEpoch,
          epochEndTime: String(Math.floor(Date.now() / 1000) + 3600),
          jackpotInfo: [hugeWei, hugeWei, "0", "0", hugeEpoch, hugeEpoch, hugeWei, hugeWei],
          rolloverPool: hugeWei,
          currentEpochData: [hugeWei, "0", "0", false, false, false],
          tileData: { pools: Array(25).fill(hugeWei), users: Array(25).fill("99999999") },
          tileUserCounts: Array(25).fill(99999999),
          indexedTilePools: Array(25).fill(hugeWei),
          epochDuration: "60",
          pendingEpochDuration: null,
          pendingEpochDurationEta: null,
          pendingEpochDurationEffectiveFromEpoch: null,
          fetchedAt: Date.now(),
        }),
        });
      });
      await stressPage.route("**/api/recent-wins", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          wins: [{
            epoch: hugeEpoch,
            user: "0xffffffffffffffffffffffffffffffffffffffff",
            amount: "123456789012345678901234567890.12",
            amountRaw: hugeWei,
            tileId: 25,
            jackpotKind: "daily-weekly",
          }],
        }),
      }));
      await ensureLandingPage(stressPage, smokeOptions);
      try {
        await stressPage.waitForFunction(
          ({ epoch, rollover }) => {
            const snapshotKey = Object.keys(window.localStorage).find((key) => key.includes("live-state-snapshot"));
            if (!snapshotKey) return false;
            try {
              const snapshot = JSON.parse(window.localStorage.getItem(snapshotKey) ?? "null");
              return snapshot?.currentEpoch === epoch && snapshot?.rolloverPool === rollover;
            } catch {
              return false;
            }
          },
          { epoch: authoritativeEpoch, rollover: hugeWei },
          { timeout: TIMEOUT_MS },
        );
      } catch (error) {
        const diagnostic = await stressPage.evaluate(() => {
          const epochElement = document.querySelector('[data-testid="header-epoch-value"]');
          const snapshotKey = Object.keys(window.localStorage).find((key) => key.includes("live-state-snapshot"));
          let cachedEpoch = null;
          if (snapshotKey) {
            try {
              cachedEpoch = JSON.parse(window.localStorage.getItem(snapshotKey) ?? "null")?.currentEpoch ?? null;
            } catch {
              cachedEpoch = "invalid-json";
            }
          }
          return {
            cachedEpoch,
            epochText: epochElement?.textContent?.trim() ?? null,
            epochTitle: epochElement?.getAttribute("title") ?? null,
          };
        });
        throw new Error(
          `extreme-value snapshot did not reach the client cache: ${JSON.stringify({ stressLiveStateRequestCount, ...diagnostic })}`,
          { cause: error },
        );
      }
      const stressLayout = await stressPage.evaluate((epoch) => {
        const epochElement = document.querySelector('[data-testid="header-epoch-value"]');
        if (epochElement instanceof HTMLElement) {
          epochElement.textContent = `#${epoch}`;
          epochElement.title = `Epoch #${epoch}`;
        }
        const selectors = [
          '[data-testid="header-epoch-value"]',
          '[data-testid="header-total-pool-value"]',
          '[data-testid="header-rollover-value"]',
          '[data-testid="jackpot-daily-metric"]',
          '[data-testid="jackpot-weekly-metric"]',
          ".chain-feed-chip",
        ];
        const elements = selectors.map((selector) => document.querySelector(selector)).filter((element) => element instanceof HTMLElement);
        return {
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          missingTitles: elements.filter((element) => !element.getAttribute("title")).map((element) => element.getAttribute("data-testid") || element.className),
          outsideViewport: elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { label: element.getAttribute("data-testid") || "chain-feed-chip", left: rect.left, right: rect.right };
          }).filter(({ left, right }) => left < -1 || right > window.innerWidth + 1),
        };
      }, hugeEpoch);
      await stressContext.close();
      if (stressLayout.horizontalOverflow > 1 || stressLayout.missingTitles.length > 0 || stressLayout.outsideViewport.length > 0) {
        throw new Error(`extreme-value layout failed: ${JSON.stringify(stressLayout)}`);
      }
      console.log("PASS long epoch, pool, rollover, jackpot, reward, and address values stay bounded");
    });

    await runStep("verify empty game and history states", async () => {
      const emptyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await emptyContext.addInitScript((tutorialKey) => {
        window.localStorage.clear();
        window.localStorage.setItem(tutorialKey, "1");
      }, FIRST_VISIT_TUTORIAL_KEY);
      const emptyPage = await emptyContext.newPage();
      installSmokePageObservers({ page: emptyPage, pageErrorSource: "empty-states", pageErrors });
      await emptyPage.route("**/api/live-state", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          currentEpoch: "1",
          epochEndTime: String(Math.floor(Date.now() / 1000) - 5),
          jackpotInfo: ["0", "0", "0", "0", "0", "0", "0", "0"],
          rolloverPool: "0",
          currentEpochData: ["0", "0", "0", false, false, false],
          tileData: { pools: Array(25).fill("0"), users: Array(25).fill("0") },
          tileUserCounts: Array(25).fill(0),
          indexedTilePools: Array(25).fill("0"),
          epochDuration: "60",
          pendingEpochDuration: null,
          pendingEpochDurationEta: null,
          pendingEpochDurationEffectiveFromEpoch: null,
          fetchedAt: Date.now(),
        }),
      }));
      await emptyPage.route("**/api/recent-wins", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ wins: [] }),
      }));
      await emptyPage.route("**/api/jackpots**", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jackpots: [] }),
      }));
      await emptyPage.route("**/api/leaderboards", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          biggestSingleWin: [], luckiest: [], oneTileWonder: [], mostWins: [],
          whales: [], underdog: [], luckyTile: [],
        }),
      }));
      await ensureLandingPage(emptyPage, smokeOptions);
      await expectVisible(emptyPage.getByText("No bets", { exact: true }), "expired empty epoch state", TIMEOUT_MS);
      const emptyPoolChartVisual = await assertEmptyPoolChartVisual({
        page: emptyPage,
        expectVisible,
        timeoutMs: TIMEOUT_MS,
      });
      const emptyPoolLabel = await emptyPoolChartVisual.getAttribute("aria-label");
      if (emptyPoolLabel !== "Pool chart empty state") {
        throw new Error(`empty pool chart aria label mismatch: ${emptyPoolLabel ?? "missing"}`);
      }
      await expectVisible(emptyPage.locator('[data-testid="header-pool-chart-line"]'), "empty pool chart line", TIMEOUT_MS);
      await expectVisible(
        emptyPage.getByText("Log in to check rewards for your wallet.", { exact: true }),
        "unchecked guest rewards status",
        TIMEOUT_MS,
      );
      await expectVisible(
        emptyPage.getByRole("button", { name: "Log in to check rewards" }),
        "guest rewards login CTA",
        TIMEOUT_MS,
      );
      if (await emptyPage.locator('[data-testid="rewards-empty-state"]').count() > 0) {
        throw new Error("guest rewards must not render a verified empty state");
      }
      const analyticsEmptyOpened = await openDesktopTab(emptyPage, {
        ...smokeOptions,
        buttonName: "Analytics",
        checks: [
          [emptyPage.getByText("No jackpot awards yet.", { exact: true }), "empty jackpot history"],
        ],
        skipMessage: "analytics empty states did not open",
      });
      if (!analyticsEmptyOpened) throw new Error("analytics empty states did not become ready");
      const leaderboardEmptyOpened = await openDesktopTab(emptyPage, {
        ...smokeOptions,
        buttonName: "Leaderboards",
        checks: [[emptyPage.locator('[data-testid="leaderboard-empty-state"]').first(), "empty leaderboards"]],
        skipMessage: "leaderboard empty state did not open",
      });
      if (!leaderboardEmptyOpened) throw new Error("leaderboard empty state did not become ready");
      await emptyContext.close();
      console.log("PASS empty pool, unchecked guest rewards, leaderboards, and jackpots remain explicit");
    });

    await runStep("verify pool chart freshness", async () => {
      const currentState = await fetchBrowserSmokeLiveState({
        baseUrl: BASE_URL,
        timeoutMs: LIVE_STATE_PROBE_TIMEOUT_MS,
      });
      const chartEpoch = String(currentState?.currentEpoch ?? "");
      if (!/^\d+$/.test(chartEpoch)) throw new Error("live-state epoch probe returned an invalid epoch");
      const chartContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await chartContext.addInitScript((tutorialKey) => {
        window.localStorage.clear();
        window.localStorage.setItem(tutorialKey, "1");
      }, FIRST_VISIT_TUTORIAL_KEY);
      const chartPage = await chartContext.newPage();
      installSmokePageObservers({ page: chartPage, pageErrorSource: "pool-chart-freshness", pageErrors });
      let updatedPool = false;
      let liveStateRequests = 0;
      await chartPage.route("**/api/live-state", (route) => {
        liveStateRequests += 1;
        const poolWei = updatedPool ? "20000000000000000000" : "10000000000000000000";
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "cache-control": "no-store" },
          body: JSON.stringify({
            currentEpoch: chartEpoch,
            epochEndTime: String(Math.floor(Date.now() / 1000) + 3600),
            jackpotInfo: ["0", "0", "0", "0", "0", "0", "0", "0"],
            rolloverPool: "0",
            currentEpochData: [poolWei, "0", "0", false, false, false],
            tileData: { pools: [poolWei, ...Array(24).fill("0")], users: Array(25).fill("0") },
            tileUserCounts: Array(25).fill(0),
            indexedTilePools: [poolWei, ...Array(24).fill("0")],
            epochDuration: "60",
            pendingEpochDuration: null,
            pendingEpochDurationEta: null,
            pendingEpochDurationEffectiveFromEpoch: null,
            fetchedAt: Date.now(),
          }),
        });
      });
      await ensureLandingPage(chartPage, smokeOptions);
      const initialSnapshotDeadline = Date.now() + 12_000;
      while (liveStateRequests < 1 && Date.now() < initialSnapshotDeadline) await chartPage.waitForTimeout(100);
      if (liveStateRequests < 1) throw new Error("initial live-state snapshot was not requested");
      await chartPage.waitForFunction(() => (
        document.querySelector('[data-testid="header-total-pool-value"]')?.textContent?.includes("10.00")
      ), undefined, { timeout: 12_000 });
      const chartLine = chartPage.locator('[data-testid="header-pool-chart-line"]');
      await expectVisible(chartLine, "initial pool chart line", TIMEOUT_MS);
      const initialPath = await chartLine.getAttribute("d");
      if (!initialPath) throw new Error("initial pool chart path is empty");
      const requestsBeforePoolUpdate = liveStateRequests;
      updatedPool = true;
      const updatedSnapshotDeadline = Date.now() + 12_000;
      while (liveStateRequests <= requestsBeforePoolUpdate && Date.now() < updatedSnapshotDeadline) {
        await chartPage.waitForTimeout(100);
      }
      if (liveStateRequests <= requestsBeforePoolUpdate) {
        throw new Error("updated live-state snapshot was not requested");
      }
      await chartPage.waitForFunction(() => (
        document.querySelector('[data-testid="header-total-pool-value"]')?.textContent?.includes("20.00")
      ), undefined, { timeout: 12_000 });
      await chartPage.waitForFunction((previousPath) => {
        const path = document.querySelector('[data-testid="header-pool-chart-line"]');
        return path instanceof SVGPathElement && path.getAttribute("d") !== previousPath;
      }, initialPath, { timeout: 12_000 });
      await chartContext.close();
      console.log("PASS pool chart reacts to a fresh same-epoch pool snapshot");
    });

    const relevantPageErrors = pageErrors.filter((entry) => !isIgnoredPageError(entry.message));
    if (relevantPageErrors.length > 0) {
      const details = relevantPageErrors
        .slice(0, 3)
        .map((entry) => `${entry.source ? `[${entry.source}] ` : ""}${entry.message}${entry.stack ? ` :: ${entry.stack.split("\n")[1] ?? ""}` : ""}`);
      throw new Error(`page errors: ${details.join(" | ")}`);
    }
    if (pageErrors.length > 0) {
      console.log(`IGNORED page errors: ${pageErrors.slice(0, 5).map((entry) => `${entry.source ? `[${entry.source}] ` : ""}${entry.message}`).join(" | ")}`);
    }
    if (consoleRegressions.length > 0) {
      throw new Error(`wallet connector regressions: ${consoleRegressions.slice(0, 3).join(" | ")}`);
    }
    const relevantConsoleErrors = consoleErrors.filter((message) => !isIgnoredHydrationNoise(message));
    if (relevantConsoleErrors.length > 0) {
      throw new Error(`unexpected console errors: ${relevantConsoleErrors.slice(0, 5).join(" | ")}`);
    }
    if (consoleErrors.length > 0) {
      console.log(`IGNORED console errors: ${consoleErrors.slice(0, 1).join(" | ")}`);
    }

    browserSmokeSteps.assertRequiredStepsComplete();
    console.log("\nBrowser smoke passed.");
  } finally {
    await browser.close();
  }
}

export function runSmokeBrowserEntrypoint(options = {}) {
  const { mainFn = main, ...cliOptions } = options;
  return runBrowserSmokeCli({ mainFn, ...cliOptions });
}

if (directExecution) {
  await runSmokeBrowserEntrypoint();
}
