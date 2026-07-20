import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import { chromium } from "playwright-core";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";
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
  verifyAutoMinerInputPersistence,
  verifyChatProfileModal,
  verifyReadOnlyMode,
} from "./smoke-browser-lib/flows.mjs";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts", "smoke-browser");
const SCREENSHOT_PATH = path.resolve(process.env.SMOKE_BROWSER_SCREENSHOT_PATH || path.join(OUTPUT_DIR, "latest-home.local.png"));
const TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_BROWSER_TIMEOUT_MS, 45_000);
const WARMUP_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_BROWSER_WARMUP_TIMEOUT_MS, 90_000);
const TILE_SELECTION_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_TILE_SELECTION_TIMEOUT_MS, 45_000);
const AUTO_MINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";
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

function isIgnoredConsoleMessage(message) {
  return [
    "linea-sepolia.drpc.org",
    "source=csp-report",
    "gc.kis.v2.scr.kaspersky-labs.com",
    "kaspersky-labs.com",
    "[AutoResolve] server keeper bootstrap",
    "useActiveWallet-",
    "Applying inline style violates the following Content Security Policy directive",
    "Loading the script 'http://gc.kis.v2.scr.kaspersky-labs.com/",
    "Loading the stylesheet 'http://gc.kis.v2.scr.kaspersky-labs.com/",
    "Can't perform a React state update on a component that hasn't mounted yet.",
    "Failed to load resource",
    "TypeError: Failed to fetch",
    "Do not know how to serialize a BigInt",
    "[HMR]",
    "[Fast Refresh]",
  ].some((part) => message.includes(part));
}

function isUnsupportedPrivyCoinbaseRegression(message) {
  return message.includes("configured chains are not") && message.includes("supported");
}

function isIgnoredHydrationNoise(message) {
  return message.includes("A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.")
    && message.includes('caret-color:"transparent"');
}

function isIgnoredPageError(message) {
  return [
    "Do not know how to serialize a BigInt",
    "Loading chunk app/layout failed",
    "ChunkLoadError",
    "Invalid or unexpected token",
  ].some((part) => message.includes(part));
}

async function runStep(label, task) {
  const startedAt = Date.now();
  console.log(`STEP ${label}...`);
  const result = await task();
  console.log(`STEP ${label} done in ${Date.now() - startedAt}ms`);
  return result;
}

async function openLoginModalWithReload(page, options, label) {
  const opened = await openLoginModal(page, options.timeoutMs);
  if (opened) return true;

  console.log(`WARN ${label} login modal did not open; reloading once before retry`);
  await safeReload(page, options.baseUrl, options.timeoutMs);
  await expectVisible(page.getByText("Manual Bet"), `${label} manual bet panel after login reload`, options.timeoutMs);
  return openLoginModal(page, options.timeoutMs);
}

async function verifyViewportShell(browser, viewport, label, smokeOptions, pageErrors) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((tutorialKey) => {
    window.localStorage.setItem(tutorialKey, "1");
  }, FIRST_VISIT_TUTORIAL_KEY);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push({ message: error.message, source: label }));
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
  const smokeOptions = {
    autoMineDebugOverrideKey: AUTO_MINE_DEBUG_OVERRIDE_KEY,
    autoMinerInputsKey: AUTO_MINER_INPUTS_KEY,
    baseUrl: BASE_URL,
    chainId: Number(process.env.NEXT_PUBLIC_LINEA_CHAIN_ID || 59141),
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
    page.on("pageerror", (error) => pageErrors.push({
      message: error.message,
      stack: error.stack || "",
    }));
    page.on("console", (message) => {
      const text = message.text();
      if (isUnsupportedPrivyCoinbaseRegression(text)) consoleRegressions.push(text);
      if (message.type() !== "error") return;
      if (!isIgnoredConsoleMessage(text)) consoleErrors.push(text);
    });

    console.log(`Browser smoke URL: ${BASE_URL}`);
    await runStep("open desktop landing page", () => ensureLandingPage(page, smokeOptions));

    await runStep("assert desktop hub shell", async () => {
      await expectVisible(page.getByRole("button", { name: "Mining Hub" }), "hub nav", TIMEOUT_MS);
      const sidebar = page.locator("aside").first();
      await expectVisible(sidebar.getByText("Hot Tiles", { exact: true }), "sidebar hot tiles", TIMEOUT_MS);
      await expectVisible(sidebar.getByText("Most wins - last 40 rounds", { exact: true }), "sidebar hot tiles subtitle", TIMEOUT_MS);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel", TIMEOUT_MS);
      await expectVisible(page.getByText("Auto-Miner"), "hub auto-miner panel", TIMEOUT_MS);
      await expectVisible(page.getByRole("button", { name: /Login \/ Connect|Wallet Loading/i }), "connect wallet button", TIMEOUT_MS);
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

    const mobileWalletContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mobileWalletContext.addInitScript((tutorialKey) => {
      try {
        window.localStorage.setItem(tutorialKey, "1");
      } catch {
        // ignore storage failures in smoke
      }
    }, FIRST_VISIT_TUTORIAL_KEY);
    const mobileWalletPage = await mobileWalletContext.newPage();
    mobileWalletPage.on("pageerror", (error) => pageErrors.push({
      message: `[mobile-wallet] ${error.message}`,
      stack: error.stack || "",
    }));
    mobileWalletPage.on("console", (message) => {
      const text = message.text();
      if (isUnsupportedPrivyCoinbaseRegression(text)) consoleRegressions.push(`[mobile-wallet] ${text}`);
      if (message.type() !== "error") return;
      if (!isIgnoredConsoleMessage(text)) consoleErrors.push(`[mobile-wallet] ${text}`);
    });
    await runStep("open isolated mobile wallet page", () => ensureLandingPage(mobileWalletPage, smokeOptions));
    await runStep("verify isolated mobile wallet selector", async () => {
      await expectVisible(mobileWalletPage.getByRole("button", { name: "Hub" }), "isolated mobile hub nav", TIMEOUT_MS);
      await expectVisible(mobileWalletPage.getByText("Manual Bet"), "isolated mobile manual bet panel", TIMEOUT_MS);
      const mobileLoginModalOpened = await openLoginModalWithReload(mobileWalletPage, smokeOptions, "isolated mobile");
      if (!mobileLoginModalOpened) {
        throw new Error("isolated mobile login modal did not open during mandatory wallet selector smoke");
      }
      await openWalletSelectorFromLoginModal(mobileWalletPage, TIMEOUT_MS);
      await closeLoginModal(mobileWalletPage, TIMEOUT_MS);
    });
    await mobileWalletContext.close();

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
        [page.getByText("Manual Bet"), "return to hub"],
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
    mobilePage.on("pageerror", (error) => pageErrors.push({
      message: `[mobile] ${error.message}`,
      stack: error.stack || "",
    }));
    mobilePage.on("console", (message) => {
      const text = message.text();
      if (isUnsupportedPrivyCoinbaseRegression(text)) consoleRegressions.push(`[mobile] ${text}`);
      if (message.type() !== "error") return;
      if (!isIgnoredConsoleMessage(text)) consoleErrors.push(`[mobile] ${text}`);
    });

    await runStep("open mobile landing page", () => ensureLandingPage(mobilePage, smokeOptions));
    await runStep("assert mobile hub shell", async () => {
      await expectVisible(mobilePage.getByRole("button", { name: "Hub" }), "mobile hub nav", TIMEOUT_MS);
      await expectVisible(mobilePage.getByRole("button", { name: "Leaderboards" }), "mobile top nav", TIMEOUT_MS);
      await expectVisible(mobilePage.getByText("Manual Bet"), "mobile manual bet panel", TIMEOUT_MS);
      await expectVisible(mobilePage.getByText("Auto-Miner"), "mobile auto-miner panel", TIMEOUT_MS);
    });
    await runStep("verify mobile touch targets", async () => {
      const undersized = await mobilePage.evaluate(() => [...document.querySelectorAll(
        'button, input:not([type="hidden"]), select, textarea, [role="button"]',
      )]
        .filter((element) => {
          if (!(element instanceof HTMLElement) || element.hasAttribute("disabled")) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
            && rect.width > 0 && rect.height > 0;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.getAttribute("aria-label") || element.getAttribute("title")
              || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) || element.tagName,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .filter((target) => target.width < 44 || target.height < 44)
        .slice(0, 10));
      if (undersized.length > 0) {
        throw new Error(`mobile touch targets below 44px: ${JSON.stringify(undersized)}`);
      }
    });
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
    await mobileContext.close();

    await runStep("verify 360px extreme-value overflow", async () => {
      const hugeEpoch = "123456789012345678901234";
      const hugeWei = "123456789012345678901234567890123456789012345678";
      const stressContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
      await stressContext.addInitScript((tutorialKey) => {
        window.localStorage.setItem(tutorialKey, "1");
      }, FIRST_VISIT_TUTORIAL_KEY);
      const stressPage = await stressContext.newPage();
      stressPage.on("pageerror", (error) => pageErrors.push({ message: error.message, source: "extreme-values" }));
      await stressPage.route("**/api/live-state", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          currentEpoch: hugeEpoch,
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
      }));
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
      await stressPage.waitForFunction(
        (epoch) => document.querySelector('[data-testid="header-epoch-value"]')?.getAttribute("title") === `Epoch #${epoch}`,
        hugeEpoch,
        { timeout: TIMEOUT_MS },
      );
      const stressLayout = await stressPage.evaluate(() => {
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
      });
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
      emptyPage.on("pageerror", (error) => pageErrors.push({ message: error.message, source: "empty-states" }));
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
      await expectVisible(emptyPage.locator('[data-testid="header-pool-chart-line"]'), "empty pool chart line", TIMEOUT_MS);
      await expectVisible(emptyPage.locator('[data-testid="rewards-empty-state"]'), "empty rewards state", TIMEOUT_MS);
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
      console.log("PASS empty pool, rewards, leaderboards, and jackpots remain explicit");
    });

    await runStep("verify pool chart freshness", async () => {
      const currentStateResponse = await fetch(new URL("/api/live-state", BASE_URL), { cache: "no-store" });
      if (!currentStateResponse.ok) throw new Error(`live-state epoch probe returned ${currentStateResponse.status}`);
      const currentState = await currentStateResponse.json();
      const chartEpoch = String(currentState?.currentEpoch ?? "");
      if (!/^\d+$/.test(chartEpoch)) throw new Error("live-state epoch probe returned an invalid epoch");
      const chartContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await chartContext.addInitScript((tutorialKey) => {
        window.localStorage.clear();
        window.localStorage.setItem(tutorialKey, "1");
      }, FIRST_VISIT_TUTORIAL_KEY);
      const chartPage = await chartContext.newPage();
      chartPage.on("pageerror", (error) => pageErrors.push({ message: error.message, source: "pool-chart-freshness" }));
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
        .map((entry) => `${entry.message}${entry.stack ? ` :: ${entry.stack.split("\n")[1] ?? ""}` : ""}`);
      throw new Error(`page errors: ${details.join(" | ")}`);
    }
    if (pageErrors.length > 0) {
      console.log(`IGNORED page errors: ${pageErrors.slice(0, 5).map((entry) => entry.message).join(" | ")}`);
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

    console.log("\nBrowser smoke passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
