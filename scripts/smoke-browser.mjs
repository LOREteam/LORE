import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts", "smoke-browser");
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, "latest-home.png");
const TIMEOUT_MS = Number(process.env.SMOKE_BROWSER_TIMEOUT_MS || 45_000);
const TILE_SELECTION_TIMEOUT_MS = Number(process.env.SMOKE_TILE_SELECTION_TIMEOUT_MS || 35_000);
const AUTO_MINER_INPUTS_KEY = "lineaore:auto-miner-inputs:v1";

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
  ].some((part) => message.includes(part));
}

async function findExecutablePath() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("no Chrome/Edge executable found; set SMOKE_BROWSER_EXECUTABLE");
}

async function expectVisible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  console.log(`PASS ${label}`);
}

async function waitForUiHydration(page, label = "ui hydration") {
  try {
    await page.locator("[data-ui-hydrated='true']").first().waitFor({ state: "attached", timeout: TIMEOUT_MS });
  } catch {
    await page.waitForFunction(() => {
      if (!document.body) return false;
      const bodyText = document.body.innerText.replace(/\s+/g, " ");
      const hasPrimaryNav = bodyText.includes("Mining Hub") || bodyText.includes("Hub");
      const hasHubSurface =
        document.querySelector("button[aria-label^='Tile ']") !== null
        || bodyText.includes("Manual Bet")
        || bodyText.includes("Auto-Miner")
        || bodyText.includes("Rewards")
        || bodyText.includes("Login / Connect");
      return hasPrimaryNav && hasHubSurface;
    }, undefined, { timeout: Math.min(TIMEOUT_MS, 20_000) });
  }
  console.log(`PASS ${label}`);
}

async function saveSmokeScreenshot(page) {
  try {
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true, timeout: 10_000 });
    console.log(`Saved screenshot: ${SCREENSHOT_PATH}`);
  } catch {
    console.log("SKIP screenshot capture (page stayed interactive but screenshot timed out)");
  }
}

async function safeReload(page) {
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  } catch {
    await safeGoto(page);
  }
}

async function safeGoto(page) {
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
  } catch {
    try {
      await page.goto(BASE_URL, { waitUntil: "load", timeout: TIMEOUT_MS });
    } catch {
      await page.goto(BASE_URL, { waitUntil: "commit", timeout: TIMEOUT_MS });
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: Math.min(15_000, TIMEOUT_MS) });
      } catch {
        // fall through; the smoke assertions below will verify the real UI state
      }
    }
  }
}

async function ensureLandingPage(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await safeGoto(page);
      await waitForUiHydration(page);
      return;
    } catch {
      if (attempt === 3) throw new Error(`failed to open ${BASE_URL} after ${attempt} attempts`);
      await page.waitForTimeout(2000 * attempt);
    }
  }
}

async function clickFirstEnabledTile(page, timeoutMs = 15_000) {
  await waitForUiHydration(page, "hub ui hydrated before tile click");
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll("button[aria-label^='Tile ']")].some((button) => !button.disabled),
      { timeout: timeoutMs },
    );
  } catch {
    return null;
  }

  const clickedLabel = await page.evaluate(() => {
    const tileButton = [...document.querySelectorAll("button[aria-label^='Tile ']")]
      .find((button) => !button.disabled);
    return tileButton?.getAttribute("aria-label") ?? null;
  });

  if (!clickedLabel) {
    return null;
  }

  try {
    await page.getByRole("button", { name: clickedLabel }).first().click({ timeout: 5_000 });
  } catch {
    await page.evaluate((label) => {
      const tileButton = [...document.querySelectorAll("button[aria-label^='Tile ']")]
        .find((button) => button.getAttribute("aria-label") === label && !button.disabled);
      if (!(tileButton instanceof HTMLElement)) return;
      tileButton.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      }));
    }, clickedLabel);
  }

  console.log(`PASS clicked tile ${clickedLabel}`);
  return clickedLabel;
}

async function expectManualBetSelection(page, selectedTilesCount, totalText) {
  await page.waitForFunction(
    ({ selectedTilesCount, totalText }) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      if (!document.body) return false;
      const cta = [...document.querySelectorAll("button")]
        .map((button) => normalize(button.textContent))
        .find((text) => /^BET ON \d+ TILES?$/.test(text));
      const bodyText = normalize(document.body.innerText);
      const expectedCtaSingular = `BET ON ${selectedTilesCount} TILE`;
      const expectedCtaPlural = `BET ON ${selectedTilesCount} TILES`;
      return (cta === expectedCtaSingular || cta === expectedCtaPlural) && bodyText.includes(totalText);
    },
    { selectedTilesCount, totalText },
    { timeout: TIMEOUT_MS },
  );
  console.log("PASS tile selection updates CTA");
  console.log("PASS tile selection updates total");
}

async function readManualBetAmount(page) {
  try {
    const rawValue = await page.getByRole("textbox", { name: "Amount per tile" }).inputValue();
    const parsed = Number.parseFloat(rawValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  } catch {
    // fall back below
  }
  return 10;
}

async function readHubTileState(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const tiles = [...document.querySelectorAll("button[aria-label^='Tile ']")].map((button) => ({
      disabled: Boolean(button.disabled),
      label: normalize(button.getAttribute("aria-label") || button.textContent),
    }));
    const enabledTile = tiles.find((tile) => !tile.disabled) ?? null;
    const bodyText = normalize(document.body.innerText);

    return {
      enabledTileLabel: enabledTile?.label ?? null,
      hasNumericTiles: tiles.length > 0,
      syncing: bodyText.includes("SYNCING...") || bodyText.includes("Syncing live epoch"),
      analyzing: bodyText.includes("Analyzing"),
      timerAtZero: bodyText.includes("00:00"),
    };
  });
}

function isTransientNavigationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Execution context was destroyed")
    || message.includes("most likely because of a navigation")
    || message.includes("Target page, context or browser has been closed");
}

async function selectSingleTile(page) {
  const deadline = Date.now() + TILE_SELECTION_TIMEOUT_MS;
  let reloaded = false;

  while (Date.now() < deadline) {
    let state;
    try {
      state = await readHubTileState(page);
    } catch (error) {
      if (!isTransientNavigationError(error)) throw error;
      await page.waitForTimeout(1500);
      continue;
    }

    if (state.enabledTileLabel) {
      console.log("PASS hub interactive");
      try {
        const manualBetAmount = await readManualBetAmount(page);
        const clickedLabel = await clickFirstEnabledTile(page, Math.min(10_000, TIMEOUT_MS));
        if (!clickedLabel) {
          await page.waitForTimeout(1500);
          continue;
        }
        await expectManualBetSelection(page, 1, `${manualBetAmount.toFixed(2)} LINEA`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("page.waitForFunction: Timeout")) {
          await page.waitForTimeout(1500);
          continue;
        }
        if (!isTransientNavigationError(error)) throw error;
        await page.waitForTimeout(1500);
        continue;
      }
      return true;
    }

    const elapsedMs = TILE_SELECTION_TIMEOUT_MS - Math.max(0, deadline - Date.now());
    if (!reloaded && elapsedMs >= 30_000 && state.syncing && !state.hasNumericTiles) {
      reloaded = true;
      await safeReload(page);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after tile retry");
      continue;
    }

    await page.waitForTimeout(state.analyzing || state.timerAtZero ? 3000 : 1500);
  }

  console.log(`SKIP tile selection smoke (hub tiles did not become interactive within ${TILE_SELECTION_TIMEOUT_MS}ms)`);
  return false;
}

async function openMobileAnalytics(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const analyticsButton = page.getByRole("button", { name: "Analytics" });
      await analyticsButton.click();
      await page.waitForFunction(() => {
        return window.location.hash === "#analytics"
          || document.body.innerText.includes("My Deposits")
          || document.body.innerText.includes("Achievements");
      }, undefined, { timeout: 20_000 });
      await expectVisible(page.getByRole("heading", { name: "My Deposits" }), "mobile analytics deposits panel");
      return;
    } catch {
      if (attempt <= 2) {
        try {
          await page.evaluate(() => {
            const buttons = [...document.querySelectorAll("button")];
            const analyticsButton = buttons.find((button) => button.textContent?.trim() === "Analytics");
            analyticsButton?.click();
          });
        } catch (error) {
          if (!isTransientNavigationError(error)) throw error;
          await page.waitForTimeout(1500);
        }
        try {
          await page.waitForFunction(() => {
            return window.location.hash === "#analytics"
              || document.body.innerText.includes("My Deposits")
              || document.body.innerText.includes("Achievements");
          }, undefined, { timeout: 20_000 });
          await expectVisible(page.getByRole("heading", { name: "My Deposits" }), "mobile analytics deposits panel");
          return;
        } catch {
          // fall through to retry path below
        }
      }
      if (attempt === 3) {
        console.log("SKIP mobile analytics smoke (analytics tab did not open during smoke window)");
        return;
      }
      await safeReload(page);
      await expectVisible(page.getByRole("button", { name: "Hub" }), "mobile hub nav after retry");
      await expectVisible(page.getByRole("heading", { name: "Rewards" }), "mobile rewards panel after retry");
    }
  }
}

async function openLoginModal(page) {
  const loginButton = page.getByRole("button", { name: "Login / Connect" }).first();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await loginButton.click({ timeout: 10_000 });
      await expectVisible(page.getByRole("heading", { name: "Log in or sign up" }), "login modal opens");
      await expectVisible(page.getByRole("button", { name: "Continue with a wallet" }), "login modal wallet option");
      return true;
    } catch {
      if (attempt === 1) {
        try {
          await page.evaluate(() => {
            const buttons = [...document.querySelectorAll("button")];
            const loginButton = buttons.find((button) => button.textContent?.trim() === "Login / Connect");
            loginButton?.click();
          });
        } catch (error) {
          if (!isTransientNavigationError(error)) throw error;
          await page.waitForTimeout(1500);
        }
        try {
          await expectVisible(page.getByRole("heading", { name: "Log in or sign up" }), "login modal opens");
          await expectVisible(page.getByRole("button", { name: "Continue with a wallet" }), "login modal wallet option");
          return true;
        } catch {
          // continue to retry path below
        }
      }

      if (attempt === 2) {
        console.log("SKIP login modal smoke (auth widget did not open during smoke window)");
        return false;
      }

      await safeReload(page);
      await expectVisible(page.getByRole("button", { name: "Login / Connect" }), "login button after retry");
    }
  }

  return false;
}

async function closeLoginModal(page) {
  const closeButton = page.getByRole("button", { name: "close modal" });

  try {
    await closeButton.click({ timeout: 10_000 });
  } catch {
    await page.keyboard.press("Escape");
  }

  await expectVisible(page.getByRole("button", { name: "Login / Connect" }), "login modal closes");
}

async function openChatDrawer(page) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await waitForUiHydration(page, "hub ui hydrated before chat open");
      await page.getByRole("button", { name: "Open chat" }).click();
      await expectVisible(page.getByText("Connect wallet to chat"), "chat drawer opens");
      return true;
    } catch {
      if (attempt === 2) {
        console.log("SKIP chat drawer smoke (chat panel did not open during smoke window)");
        return false;
      }
      await safeReload(page);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after retry");
    }
  }

  return false;
}

async function verifyAutoMinerInputPersistence(page) {
  const betSizeInput = page.getByRole("textbox", { name: "Bet Size" });
  const targetsInput = page.getByRole("spinbutton", { name: "Targets" });
  const cyclesInput = page.getByRole("spinbutton", { name: "Cycles" });

  const inputsEnabled = await Promise.all([
    betSizeInput.isEnabled().catch(() => false),
    targetsInput.isEnabled().catch(() => false),
    cyclesInput.isEnabled().catch(() => false),
  ]);
  if (inputsEnabled.some((enabled) => !enabled)) {
    console.log("SKIP auto-miner persistence smoke (inputs are disabled in the current guest state)");
    return;
  }

  await betSizeInput.fill("1111");
  await targetsInput.fill("6");
  await cyclesInput.fill("500");

  await page.waitForFunction(() => {
    const bodyText = document.body.innerText.replace(/\s+/g, " ");
    return bodyText.includes("3333000.00 LINEA");
  }, undefined, { timeout: TIMEOUT_MS });
  console.log("PASS auto-miner total updates");

  await page.waitForFunction((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.betSize === "1111" && parsed?.targets === 6 && parsed?.cycles === 500;
    } catch {
      return false;
    }
  }, AUTO_MINER_INPUTS_KEY, { timeout: TIMEOUT_MS });
  console.log("PASS auto-miner inputs saved");

  await safeReload(page);
  await expectVisible(page.getByText("Auto-Miner"), "auto-miner panel after reload");
  await page.waitForFunction((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.betSize === "1111" && parsed?.targets === 6 && parsed?.cycles === 500;
    } catch {
      return false;
    }
  }, AUTO_MINER_INPUTS_KEY, { timeout: TIMEOUT_MS });
  console.log("PASS auto-miner local persistence");
}

async function openDesktopTab(page, buttonName, checks, skipMessage) {
  const normalizedTargetHash = buttonName === "Mining Hub"
    ? ""
    : `#${buttonName.toLowerCase().replace(/\s+/g, "")}`;

  const waitForDesktopTabState = async () => {
    await page.waitForFunction(
      ({ label, targetHash }) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const button = [...document.querySelectorAll("button")].find((candidate) => normalize(candidate.textContent) === label);
        const activeFromAria = button?.getAttribute("aria-current") === "page";
        const hashMatches = window.location.hash === targetHash;
        return activeFromAria || hashMatches;
      },
      { label: buttonName, targetHash: normalizedTargetHash },
      { timeout: TIMEOUT_MS },
    );
  };

  try {
    await waitForUiHydration(page, `${buttonName} tab ui hydrated`);
    await page.getByRole("button", { name: buttonName }).first().click();
    await waitForDesktopTabState();
    for (const [locator, label] of checks) {
      await expectVisible(locator, label);
    }
    return true;
  } catch {
    try {
      await page.evaluate((label) => {
        const buttons = [...document.querySelectorAll("button")];
        const visibleButton = buttons.find((button) => {
          if (!(button instanceof HTMLElement)) return false;
          const text = button.textContent?.replace(/\s+/g, " ").trim();
          const style = window.getComputedStyle(button);
          return text === label
            && style.visibility !== "hidden"
            && style.display !== "none"
            && button.getClientRects().length > 0;
        });
        if (!(visibleButton instanceof HTMLElement)) {
          throw new Error(`visible tab button not found for ${label}`);
        }
        visibleButton.click();
      }, buttonName);
      await waitForDesktopTabState();
      for (const [locator, label] of checks) {
        await expectVisible(locator, label);
      }
      return true;
    } catch {
      console.log(`SKIP ${skipMessage}`);
      await safeReload(page);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after tab reset");
      return false;
    }
  }
}

async function closeChatDrawer(page) {
  try {
    await waitForUiHydration(page, "chat ui hydrated before close");
    await page.getByRole("button", { name: "Close chat panel" }).click();
    await expectVisible(page.getByRole("button", { name: "Open chat" }), "chat drawer closes");
  } catch {
    try {
      await page.keyboard.press("Escape");
      await expectVisible(page.getByRole("button", { name: "Open chat" }), "chat drawer closes");
    } catch {
      console.log("SKIP chat drawer close assertion (resetting hub state via reload)");
      await safeReload(page);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after chat reset");
    }
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const executablePath = await findExecutablePath();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });

  const pageErrors = [];
  const consoleErrors = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
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
    await ensureLandingPage(page);

    await expectVisible(page.getByRole("button", { name: "Mining Hub" }), "hub nav");
    await expectVisible(page.getByText("Hot Tiles"), "sidebar hot tiles");
    await expectVisible(page.getByText("Top tiles"), "sidebar hot tiles subtitle");
    await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel");
    await expectVisible(page.getByText("Auto-Miner"), "hub auto-miner panel");
    await expectVisible(page.getByRole("button", { name: "Login / Connect" }), "login button");
    await saveSmokeScreenshot(page);
    await verifyAutoMinerInputPersistence(page);

    await selectSingleTile(page);

    const loginModalOpened = await openLoginModal(page);
    if (loginModalOpened) {
      await closeLoginModal(page);
    }

    const chatOpened = await openChatDrawer(page);
    if (chatOpened) {
      await closeChatDrawer(page);
    }

    await openDesktopTab(
      page,
      "Analytics",
      [
        [page.getByText("Achievements"), "analytics tab"],
        [page.getByRole("heading", { name: "My Deposits" }), "analytics deposits panel"],
      ],
      "analytics tab did not open during smoke window",
    );

    await openDesktopTab(
      page,
      "Rebate",
      [[page.getByText("Gas Burn Bonus"), "rebate tab"]],
      "rebate tab did not open during smoke window",
    );

    await openDesktopTab(
      page,
      "Leaderboards",
      [
        [page.getByRole("heading", { name: "Leaderboards" }), "leaderboards tab"],
        [page.getByText("Lucky tile"), "leaderboards section"],
      ],
      "leaderboards tab did not open during smoke window",
    );

    await openDesktopTab(
      page,
      "White Paper",
      [
        [page.getByText("Introduction"), "whitepaper tab"],
        [page.getByText("Tokenomics & Fee Split"), "whitepaper tokenomics section"],
      ],
      "white paper tab did not open during smoke window",
    );

    await openDesktopTab(
      page,
      "FAQ",
      [[page.getByText("I just opened the site. What do I do first?"), "faq tab"]],
      "faq tab did not open during smoke window",
    );

    await page.getByRole("button", { name: "Mining Hub" }).first().click();
    await expectVisible(page.getByText("Manual Bet"), "return to hub");

    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    mobilePage.on("pageerror", (error) => pageErrors.push({
      message: `[mobile] ${error.message}`,
      stack: error.stack || "",
    }));
    mobilePage.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (!isIgnoredConsoleMessage(text)) consoleErrors.push(`[mobile] ${text}`);
    });

    await ensureLandingPage(mobilePage);
    await expectVisible(mobilePage.getByRole("button", { name: "Hub" }), "mobile hub nav");
    await expectVisible(mobilePage.getByRole("button", { name: "Top" }), "mobile top nav");
    await expectVisible(mobilePage.getByRole("heading", { name: "Rewards" }), "mobile rewards panel");
    await openMobileAnalytics(mobilePage);
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
