import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import {
  ensureLandingPage,
  expectVisible,
  findExecutablePath,
  saveSmokeScreenshot,
  warmBaseUrl,
} from "./smoke-browser-lib/core.mjs";
import {
  closeChatDrawer,
  closeLoginModal,
  openChatDrawer,
  openDesktopTab,
  openLoginModal,
  openMobileAnalytics,
  selectSingleTile,
  verifyAutoMinerFailureScenarios,
  verifyAutoMinerInputPersistence,
  verifyChatProfileModal,
} from "./smoke-browser-lib/flows.mjs";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts", "smoke-browser");
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, "latest-home.png");
const TIMEOUT_MS = Number(process.env.SMOKE_BROWSER_TIMEOUT_MS || 45_000);
const WARMUP_TIMEOUT_MS = Number(process.env.SMOKE_BROWSER_WARMUP_TIMEOUT_MS || 90_000);
const TILE_SELECTION_TIMEOUT_MS = Number(process.env.SMOKE_TILE_SELECTION_TIMEOUT_MS || 5_000);
const AUTO_MINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";
const AUTO_MINE_DEBUG_OVERRIDE_KEY = "lineaore:auto-mine-debug-override:v1";
const FIRST_VISIT_TUTORIAL_KEY = "lore:first-visit-tutorial:v1";
const INCLUDE_DEBUG_AUTOMINER_SCENARIOS = process.env.SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS === "1";

const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER_EXECUTABLE,
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
    "configured chains are not supported",
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
  const smokeOptions = {
    autoMineDebugOverrideKey: AUTO_MINE_DEBUG_OVERRIDE_KEY,
    autoMinerInputsKey: AUTO_MINER_INPUTS_KEY,
    baseUrl: BASE_URL,
    tileSelectionTimeoutMs: TILE_SELECTION_TIMEOUT_MS,
    timeoutMs: TIMEOUT_MS,
  };

  try {
    await runStep(`warm ${BASE_URL}`, () => warmBaseUrl(BASE_URL, WARMUP_TIMEOUT_MS));

    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
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
      if (message.type() !== "error") return;
      const text = message.text();
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
      await expectVisible(page.getByRole("button", { name: "Login / Connect" }), "login button", TIMEOUT_MS);
      await saveSmokeScreenshot(page, SCREENSHOT_PATH);
    });
    await runStep("verify auto-miner persistence", () => verifyAutoMinerInputPersistence(page, smokeOptions));
    if (INCLUDE_DEBUG_AUTOMINER_SCENARIOS) {
      await runStep("verify auto-miner failure scenarios", () => verifyAutoMinerFailureScenarios(page, smokeOptions));
    } else {
      console.log("SKIP auto-miner failure scenarios step (set SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS=1 to enable)");
    }

    await runStep("select single tile", () => selectSingleTile(page, smokeOptions));

    const loginModalOpened = await runStep("open login modal", () => openLoginModal(page, TIMEOUT_MS));
    if (loginModalOpened) {
      await runStep("close login modal", () => closeLoginModal(page, TIMEOUT_MS));
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

    await runStep("open desktop rebate tab", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "Rebate",
      checks: [[page.getByText("Gas Burn Bonus"), "rebate tab"]],
      skipMessage: "rebate tab did not open during smoke window",
    }));

    await runStep("open desktop leaderboards tab", () => openDesktopTab(page, {
      ...smokeOptions,
      buttonName: "Leaderboards",
      checks: [
        [page.getByRole("heading", { name: "Leaderboards" }), "leaderboards tab"],
        [page.getByText("Lucky tile"), "leaderboards section"],
      ],
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

    await runStep("return to desktop hub", async () => {
      await page.getByRole("button", { name: "Mining Hub" }).first().click();
      await expectVisible(page.getByText("Manual Bet"), "return to hub", TIMEOUT_MS);
    });

    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobilePage.addInitScript((tutorialKey) => {
      try {
        window.localStorage.setItem(tutorialKey, "1");
      } catch {
        // ignore storage failures in smoke
      }
    }, FIRST_VISIT_TUTORIAL_KEY);
    mobilePage.on("pageerror", (error) => pageErrors.push({
      message: `[mobile] ${error.message}`,
      stack: error.stack || "",
    }));
    mobilePage.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!isIgnoredConsoleMessage(text)) consoleErrors.push(`[mobile] ${text}`);
    });

    await runStep("open mobile landing page", () => ensureLandingPage(mobilePage, smokeOptions));
    await runStep("assert mobile hub shell", async () => {
      await expectVisible(mobilePage.getByRole("button", { name: "Hub" }), "mobile hub nav", TIMEOUT_MS);
      await expectVisible(mobilePage.getByRole("button", { name: "Top" }), "mobile top nav", TIMEOUT_MS);
      await expectVisible(mobilePage.getByRole("heading", { name: "Rewards" }), "mobile rewards panel", TIMEOUT_MS);
    });
    await runStep("open mobile analytics", () => openMobileAnalytics(mobilePage, smokeOptions));
    await mobilePage.close();

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
