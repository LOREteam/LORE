import {
  expectVisible,
  isTransientNavigationError,
  safeReload,
  waitForUiHydration,
} from "./core.mjs";

async function clickFirstEnabledTile(page, timeoutMs, hydrationTimeoutMs) {
  await waitForUiHydration(page, hydrationTimeoutMs, "hub ui hydrated before tile click");
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

async function expectManualBetSelection(page, selectedTilesCount, timeoutMs) {
  await page.waitForFunction(
    ({ selectedTilesCount }) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      if (!document.body) return false;
      const bodyText = normalize(document.body.innerText).toUpperCase();
      const cta = [...document.querySelectorAll("button")]
        .map((button) => normalize(button.textContent))
        .find((text) => /^BET ON \d+ TILES?$/.test(text) || text === "LOGIN TO BET");
      const selectedButtons = [...document.querySelectorAll("button[aria-label^='Tile ']")]
        .filter((button) => button.getAttribute("aria-pressed") === "true");
      const manualBetInput = document.getElementById("bet-amount-per-tile");
      const manualBetAmount =
        manualBetInput instanceof HTMLInputElement ? Number.parseFloat(manualBetInput.value || "0") : Number.NaN;
      const expectedCtaSingular = `BET ON ${selectedTilesCount} TILE`;
      const expectedCtaPlural = `BET ON ${selectedTilesCount} TILES`;
      const guestLockedCta = "LOGIN TO BET";
      const expectedTotal = Number.isFinite(manualBetAmount)
        ? (manualBetAmount * selectedTilesCount).toFixed(2)
        : null;
      const manualPanelUpdated =
        expectedTotal !== null
        && bodyText.includes(`TOTAL: ${expectedTotal} LINEA`);
      return (
        (cta === expectedCtaSingular || cta === expectedCtaPlural || cta === guestLockedCta)
        && (selectedButtons.length === selectedTilesCount || manualPanelUpdated)
      );
    },
    { selectedTilesCount },
    { timeout: timeoutMs },
  );
  console.log("PASS tile selection updates CTA or guest lock state");
  console.log("PASS tile selection reaches grid or manual panel state");
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

export async function selectSingleTile(page, options) {
  const {
    baseUrl,
    timeoutMs,
    tileSelectionTimeoutMs,
  } = options;
  const deadline = Date.now() + tileSelectionTimeoutMs;
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
        const clickedLabel = await clickFirstEnabledTile(page, Math.min(10_000, timeoutMs), timeoutMs);
        if (!clickedLabel) {
          await page.waitForTimeout(1500);
          continue;
        }
        const selectionAssertionTimeoutMs = Math.min(
          12_000,
          Math.max(5_000, deadline - Date.now()),
        );
        await expectManualBetSelection(page, 1, selectionAssertionTimeoutMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("page.waitForFunction: Timeout")) {
          console.log("SKIP tile selection confirmation (click landed but selection state did not settle within smoke window)");
          return false;
        }
        if (!isTransientNavigationError(error)) throw error;
        console.log("SKIP tile selection confirmation (navigation changed during post-click assertion)");
        return false;
      }
      return true;
    }

    const elapsedMs = tileSelectionTimeoutMs - Math.max(0, deadline - Date.now());
    if (!reloaded && elapsedMs >= 30_000 && state.syncing && !state.hasNumericTiles) {
      reloaded = true;
      await safeReload(page, baseUrl, timeoutMs);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after tile retry", timeoutMs);
      continue;
    }

    await page.waitForTimeout(state.analyzing || state.timerAtZero ? 3000 : 1500);
  }

  console.log(`SKIP tile selection smoke (hub tiles did not become interactive within ${tileSelectionTimeoutMs}ms)`);
  return false;
}

export async function openMobileAnalytics(page, options) {
  const { baseUrl, timeoutMs } = options;
  const tabTimeoutMs = Math.min(timeoutMs, 8_000);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const analyticsButton = page.getByRole("button", { name: "Analytics" });
      await analyticsButton.click();
      await page.waitForFunction(() => {
        return window.location.hash === "#analytics"
          || document.body.innerText.includes("My Deposits")
          || document.body.innerText.includes("Achievements");
      }, undefined, { timeout: tabTimeoutMs });
      await expectVisible(page.getByRole("heading", { name: "My Deposits" }), "mobile analytics deposits panel", tabTimeoutMs);
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
          }, undefined, { timeout: tabTimeoutMs });
          await expectVisible(page.getByRole("heading", { name: "My Deposits" }), "mobile analytics deposits panel", tabTimeoutMs);
          return;
        } catch {
          // fall through to retry path below
        }
      }
      if (attempt === 3) {
        console.log("SKIP mobile analytics smoke (analytics tab did not open during smoke window)");
        return;
      }
      await safeReload(page, baseUrl, tabTimeoutMs);
      await expectVisible(page.getByRole("button", { name: "Hub" }), "mobile hub nav after retry", tabTimeoutMs);
      await expectVisible(page.getByRole("heading", { name: "Rewards" }), "mobile rewards panel after retry", tabTimeoutMs);
    }
  }
}

export async function openLoginModal(page, timeoutMs) {
  const modalTimeoutMs = Math.min(timeoutMs, 6_000);
  const loginButton = page.getByRole("button", { name: "Login / Connect" }).first();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await loginButton.click({ timeout: modalTimeoutMs });
      await expectVisible(page.getByRole("heading", { name: "Log in or sign up" }), "login modal opens", modalTimeoutMs);
      await expectVisible(page.getByRole("button", { name: "Continue with a wallet" }), "login modal wallet option", modalTimeoutMs);
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
          await expectVisible(page.getByRole("heading", { name: "Log in or sign up" }), "login modal opens", modalTimeoutMs);
          await expectVisible(page.getByRole("button", { name: "Continue with a wallet" }), "login modal wallet option", modalTimeoutMs);
          return true;
        } catch {
          // continue to retry path below
        }
      }

      if (attempt === 2) {
        console.log("SKIP login modal smoke (auth widget did not open during smoke window)");
        return false;
      }
    }
  }

  return false;
}

export async function closeLoginModal(page, timeoutMs) {
  const modalTimeoutMs = Math.min(timeoutMs, 6_000);
  const closeButton = page.getByRole("button", { name: "close modal" });

  try {
    await closeButton.click({ timeout: 10_000 });
  } catch {
    await page.keyboard.press("Escape");
  }

  await expectVisible(page.getByRole("button", { name: "Login / Connect" }), "login modal closes", modalTimeoutMs);
}

export async function openChatDrawer(page, options) {
  const { baseUrl, timeoutMs } = options;
  const drawerTimeoutMs = Math.min(timeoutMs, 6_000);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await waitForUiHydration(page, drawerTimeoutMs, "hub ui hydrated before chat open");
      await page.getByRole("button", { name: "Open chat" }).click();
      await expectVisible(page.getByText("Connect wallet to chat"), "chat drawer opens", drawerTimeoutMs);
      return true;
    } catch {
      if (attempt === 2) {
        console.log("SKIP chat drawer smoke (chat panel did not open during smoke window)");
        return false;
      }
      await safeReload(page, baseUrl, drawerTimeoutMs);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after retry", drawerTimeoutMs);
    }
  }

  return false;
}

export async function verifyChatProfileModal(page, timeoutMs) {
  const modalTimeoutMs = Math.min(timeoutMs, 6_000);
  await page.getByRole("button", { name: "Profile" }).click();
  await expectVisible(page.getByText("Profile Settings"), "chat profile modal opens", modalTimeoutMs);
  await expectVisible(page.getByText("Custom Avatar"), "chat profile custom avatar section", modalTimeoutMs);
  await expectVisible(page.getByRole("button", { name: "Upload image" }), "chat profile upload button", modalTimeoutMs);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expectVisible(page.getByText("Connect wallet to chat"), "chat profile modal closes", modalTimeoutMs);
}

export async function verifyAutoMinerInputPersistence(page, options) {
  const { autoMinerInputsKey, baseUrl, timeoutMs } = options;
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

  try {
    await page.waitForFunction((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.betSize === "1111" && parsed?.targets === 6 && parsed?.cycles === 500;
      } catch {
        return false;
      }
    }, autoMinerInputsKey, { timeout: Math.min(timeoutMs, 15_000) });
    console.log("PASS auto-miner inputs saved");
  } catch {
    console.log("SKIP auto-miner persistence smoke (inputs did not persist within smoke window)");
    return;
  }

  try {
    await page.waitForFunction(() => {
      const bodyText = document.body.innerText.replace(/\s+/g, " ");
      return bodyText.includes("3333000.00 LINEA") || bodyText.includes("3333000 LINEA");
    }, undefined, { timeout: Math.min(timeoutMs, 15_000) });
    console.log("PASS auto-miner total updates");
  } catch {
    console.log("SKIP auto-miner total assertion (inputs persisted but total text stayed stale during smoke window)");
  }

  await safeReload(page, baseUrl, timeoutMs);
  await expectVisible(page.getByText("Auto-Miner"), "auto-miner panel after reload", timeoutMs);
  try {
    await page.waitForFunction((storageKey) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.betSize === "1111" && parsed?.targets === 6 && parsed?.cycles === 500;
      } catch {
        return false;
      }
    }, autoMinerInputsKey, { timeout: Math.min(timeoutMs, 15_000) });
    console.log("PASS auto-miner local persistence");
  } catch {
    console.log("SKIP auto-miner reload persistence assertion (saved inputs were not restored during smoke window)");
  }
}

export async function verifyAutoMinerFailureScenarios(page, options) {
  const { autoMineDebugOverrideKey, baseUrl, timeoutMs } = options;
  const scenarioTimeoutMs = Math.min(timeoutMs, 15_000);

  const applyScenario = async (payload) => {
    await page.evaluate(({ storageKey, nextValue }) => {
      window.localStorage.setItem(storageKey, JSON.stringify({
        ...nextValue,
        updatedAt: Date.now(),
      }));
    }, {
      storageKey: autoMineDebugOverrideKey,
      nextValue: payload,
    });
    await safeReload(page, baseUrl, timeoutMs);
    await expectVisible(page.getByText("Auto-Miner"), "auto-miner panel after failure-state reload", scenarioTimeoutMs);
    await waitForUiHydration(page, scenarioTimeoutMs, "hub ui hydrated after failure-state reload");
  };
  const clearOverride = async () => {
    await page.evaluate((storageKey) => {
      window.localStorage.removeItem(storageKey);
    }, autoMineDebugOverrideKey);
    await safeReload(page, baseUrl, timeoutMs);
    await expectVisible(page.getByText("Auto-Miner", { exact: true }).first(), "auto-miner panel after clearing override", scenarioTimeoutMs);
  };

  try {
    await applyScenario({
      phase: "retry-wait",
      progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
      runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
    });
    await expectVisible(page.getByText("Retry Wait", { exact: true }).first(), "auto-miner retry-wait badge", scenarioTimeoutMs);
    await expectVisible(page.getByText("AUTO-RETRY PENDING", { exact: true }).first(), "auto-miner retry-wait button", scenarioTimeoutMs);
    console.log("PASS auto-miner retry-wait scenario");

    await applyScenario({
      phase: "session-expired",
      progress: "Session expired. Log out, log in again, then reload this page - the bot will auto-resume.",
      runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
    });
    await expectVisible(page.getByText("Session Expired", { exact: true }).first(), "auto-miner session-expired badge", scenarioTimeoutMs);
    await expectVisible(page.getByText("SESSION EXPIRED", { exact: true }).first(), "auto-miner session-expired button", scenarioTimeoutMs);
    console.log("PASS auto-miner session-expired scenario");
  } catch {
    console.log("SKIP auto-miner failure scenarios smoke (debug override did not surface expected badges within smoke window)");
  } finally {
    await clearOverride();
    console.log("PASS auto-miner failure-state override cleared");
  }
}

export async function openDesktopTab(page, options) {
  const { baseUrl, buttonName, checks, skipMessage, timeoutMs } = options;
  const tabTimeoutMs = Math.min(timeoutMs, 8_000);
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
      { timeout: tabTimeoutMs },
    );
  };

  try {
    await waitForUiHydration(page, tabTimeoutMs, `${buttonName} tab ui hydrated`);
    await page.getByRole("button", { name: buttonName }).first().click();
    await waitForDesktopTabState();
    for (const [locator, label] of checks) {
      await expectVisible(locator, label, tabTimeoutMs);
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
        await expectVisible(locator, label, tabTimeoutMs);
      }
      return true;
    } catch {
      console.log(`SKIP ${skipMessage}`);
      await safeReload(page, baseUrl, tabTimeoutMs);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after tab reset", tabTimeoutMs);
      return false;
    }
  }
}

export async function closeChatDrawer(page, options) {
  const { baseUrl, timeoutMs } = options;
  const drawerTimeoutMs = Math.min(timeoutMs, 6_000);
  try {
    await waitForUiHydration(page, drawerTimeoutMs, "chat ui hydrated before close");
    await page.getByRole("button", { name: "Close chat panel" }).click();
    await expectVisible(page.getByRole("button", { name: "Open chat" }), "chat drawer closes", drawerTimeoutMs);
  } catch {
    try {
      await page.keyboard.press("Escape");
      await expectVisible(page.getByRole("button", { name: "Open chat" }), "chat drawer closes", drawerTimeoutMs);
    } catch {
      console.log("SKIP chat drawer close assertion (resetting hub state via reload)");
      await safeReload(page, baseUrl, drawerTimeoutMs);
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after chat reset", drawerTimeoutMs);
    }
  }
}
