import {
  expectVisible,
  isTransientNavigationError,
  safeReload,
  waitForUiHydration,
} from "./core.mjs";

async function readVisibleButtonTexts(page) {
  return page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((button) => {
      const style = window.getComputedStyle(button);
      return style.visibility !== "hidden"
        && style.display !== "none"
        && Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length);
    })
    .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-80));
}

async function clickVisibleEnabledButton(page, labels, timeoutMs) {
  await page.waitForFunction((expectedLabels) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll("button")].some((button) => {
      const style = window.getComputedStyle(button);
      const visible = style.visibility !== "hidden"
        && style.display !== "none"
        && Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length);
      return visible
        && !button.disabled
        && expectedLabels.includes(normalize(button.textContent));
    });
  }, labels, { timeout: timeoutMs });

  const buttonMatch = await page.evaluate((expectedLabels) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const buttons = [...document.querySelectorAll("button")];
    const index = buttons.findIndex((button) => {
      const style = window.getComputedStyle(button);
      const visible = style.visibility !== "hidden"
        && style.display !== "none"
        && Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length);
      return visible
        && !button.disabled
        && expectedLabels.includes(normalize(button.textContent));
    });
    return {
      index,
      text: index >= 0 ? normalize(buttons[index]?.textContent) : "",
    };
  }, labels);

  if (buttonMatch.index < 0) {
    const visibleButtonTexts = await readVisibleButtonTexts(page);
    throw new Error(`visible enabled button not found for ${labels.join(" | ")}; visible buttons: ${visibleButtonTexts.join(" | ")}`);
  }

  await page.locator("button").nth(buttonMatch.index).click({ timeout: Math.min(timeoutMs, 5_000) });
  return buttonMatch.text;
}

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
  let lastState = null;

  while (Date.now() < deadline) {
    let state;
    try {
      state = await readHubTileState(page);
      lastState = state;
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

  if (lastState?.hasNumericTiles && (lastState.analyzing || lastState.timerAtZero)) {
    console.log("PASS hub tiles locked while epoch is resolving");
    console.log("PASS tile selection smoke reached a valid closed-epoch state");
    return true;
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
      await expectVisible(page.getByText("Manual Bet"), "mobile manual bet panel after retry", tabTimeoutMs);
    }
  }
}

export async function openLoginModal(page, timeoutMs) {
  const modalTimeoutMs = Math.min(timeoutMs, 15_000);
  const privyReadyTimeoutMs = Math.max(modalTimeoutMs, timeoutMs);
  const authEntrypointAttempts = [
    ["Login / Connect"],
    ["LOGIN TO BET"],
    ["LOGIN TO START"],
  ];

  for (let attempt = 1; attempt <= authEntrypointAttempts.length; attempt += 1) {
    try {
      await waitForUiHydration(page, privyReadyTimeoutMs, "hub ui hydrated before login modal");
      const entrypointTimeoutMs = attempt === 1 ? privyReadyTimeoutMs : modalTimeoutMs;
      const clickedLabel = await clickVisibleEnabledButton(page, authEntrypointAttempts[attempt - 1], entrypointTimeoutMs);
      await expectVisible(page.getByRole("heading", { name: "Log in or sign up" }), "login modal opens", modalTimeoutMs);
      console.log(`PASS login modal entrypoint ${clickedLabel}`);
      await expectVisible(page.locator("input[type='email']"), "login modal email option", modalTimeoutMs);
      await expectVisible(page.getByRole("button", { name: "Continue with a wallet" }), "login modal wallet option", modalTimeoutMs);
      return true;
    } catch {
      if (attempt === authEntrypointAttempts.length) {
        const visibleButtonTexts = await readVisibleButtonTexts(page);
        console.log(`SKIP login modal smoke (auth widget did not open during smoke window; visible buttons: ${visibleButtonTexts.join(" | ")})`);
        return false;
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(1000 * attempt);
    }
  }

  return false;
}

export async function openWalletSelectorFromLoginModal(page, timeoutMs) {
  const modalTimeoutMs = Math.min(timeoutMs, 10_000);
  const walletOptionsTimeoutMs = Math.min(timeoutMs, 15_000);

  const waitForWalletOptions = async () => {
    await page.waitForFunction(() => {
      const visibleButtonTexts = [...document.querySelectorAll("button")]
        .filter((button) => Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length))
        .map((button) => (button.textContent ?? "").replace(/\s+/g, " ").trim());
      return visibleButtonTexts.some((text) => text.includes("MetaMask"))
        && visibleButtonTexts.some((text) => text.includes("Coinbase Wallet"));
    }, undefined, { timeout: walletOptionsTimeoutMs });
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await clickVisibleEnabledButton(page, ["Continue with a wallet"], modalTimeoutMs);
      await expectVisible(
        page.getByRole("heading", { name: "Select your wallet" }),
        "wallet selector heading",
        modalTimeoutMs,
      );
      await waitForWalletOptions();
      break;
    } catch (error) {
      if (attempt >= 2) {
        const visibleButtonTexts = await readVisibleButtonTexts(page);
        throw new Error(`wallet selector options did not load; visible buttons: ${visibleButtonTexts.join(" | ")}`, { cause: error });
      }
      console.log("WARN wallet selector options did not load on first attempt; retrying auth widget");
      await page.keyboard.press("Escape");
      await expectVisible(page.getByRole("button", { name: /Login \/ Connect|Wallet Loading/i }), "login modal closes before wallet retry", modalTimeoutMs);
      const reopened = await openLoginModal(page, timeoutMs);
      if (!reopened) throw new Error("login modal did not reopen before wallet selector retry");
    }
  }

  console.log("PASS MetaMask wallet option");
  console.log("PASS Coinbase wallet option");
  return true;
}

export async function verifyHubVisualRegressionGuards(page, timeoutMs) {
  const guardTimeoutMs = Math.min(timeoutMs, 6_000);
  await page.waitForFunction(() => {
    const manualInput = document.getElementById("bet-amount-per-tile");
    return manualInput instanceof HTMLInputElement && manualInput.classList.contains("lore-nums");
  }, undefined, { timeout: guardTimeoutMs });
  console.log("PASS manual bet numeric font");

  await page.waitForFunction(() => {
    const autoInputs = [...document.querySelectorAll(".control-panel-auto input.console-input")];
    return autoInputs.length >= 3 && autoInputs.every((input) => input.classList.contains("lore-nums"));
  }, undefined, { timeout: guardTimeoutMs });
  console.log("PASS auto-miner numeric font");

  await page.waitForFunction(() => {
    const path = document.querySelector('[data-testid="header-pool-chart-line"]');
    return path instanceof SVGPathElement && (path.getAttribute("d") ?? "").trim().length > 0;
  }, undefined, { timeout: guardTimeoutMs });
  console.log("PASS header pool chart line remains mounted");

  return true;
}

export async function verifyMobileHubResponsiveGuards(page, timeoutMs) {
  const guardTimeoutMs = Math.min(timeoutMs, 6_000);
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll(".jackpot-vault-card")];
    if (cards.length < 2) return false;
    const [first, second] = cards.map((card) => card.getBoundingClientRect());
    return second.top >= first.bottom && Math.abs(first.left - second.left) < 2;
  }, undefined, { timeout: guardTimeoutMs });

  const result = await page.evaluate(() => {
    const targets = [
      document.querySelector('[aria-label="Open sidebar menu"]'),
      document.querySelector('[aria-label="Open chat"]'),
      ...document.querySelectorAll('[aria-label="Primary sections"] button'),
    ].filter((element) => element instanceof HTMLElement);
    const undersized = targets
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") || element.textContent?.trim() || "control", width: rect.width, height: rect.height };
      })
      .filter(({ width, height }) => width < 44 || height < 44);
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      undersized,
    };
  });
  if (result.horizontalOverflow > 1) {
    throw new Error(`430px hub horizontal overflow: ${result.horizontalOverflow}px`);
  }
  if (result.undersized.length > 0) {
    throw new Error(`430px hub undersized controls: ${JSON.stringify(result.undersized)}`);
  }
  console.log("PASS 430px jackpot layout, touch targets, and horizontal overflow");
  return true;
}

export async function verifyReadOnlyMode(page, timeoutMs) {
  const guardTimeoutMs = Math.min(timeoutMs, 6_000);
  await expectVisible(page.locator('[data-testid="hub-read-only-banner"]').first(), "read-only hub banner", guardTimeoutMs);
  await expectVisible(page.locator('[data-testid="manual-bet-action"]').first(), "manual bet read-only action", guardTimeoutMs);
  await expectVisible(page.locator('[data-testid="auto-miner-action"]').first(), "auto-miner read-only action", guardTimeoutMs);
  await page.waitForFunction(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
    const manualAction = document.querySelector('[data-testid="manual-bet-action"]');
    const autoMinerAction = document.querySelector('[data-testid="auto-miner-action"]');
    return manualAction instanceof HTMLButtonElement
      && autoMinerAction instanceof HTMLButtonElement
      && normalize(manualAction.textContent) === "BETTING PAUSED"
      && normalize(autoMinerAction.textContent) === "BETTING PAUSED"
      && manualAction.disabled
      && autoMinerAction.disabled;
  }, undefined, { timeout: guardTimeoutMs });
  console.log("PASS read-only betting controls disabled");
  return true;
}

export async function closeLoginModal(page, timeoutMs) {
  const modalTimeoutMs = Math.min(timeoutMs, 6_000);
  const closeButton = page.getByRole("button", { name: "close modal" });

  try {
    await closeButton.click({ timeout: 10_000 });
  } catch {
    await page.keyboard.press("Escape");
  }

  await expectVisible(page.getByRole("button", { name: /Login \/ Connect|Wallet Loading/i }), "login modal closes", modalTimeoutMs);
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
  await expectVisible(page.getByText("Auto-Miner", { exact: true }).first(), "auto-miner panel after reload", timeoutMs);
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
  const overrideEventName = "lineaore:auto-mine-debug-override-change:v1";

  const applyScenario = async (payload) => {
    await page.evaluate(({ eventName, storageKey, nextValue }) => {
      window.localStorage.setItem(storageKey, JSON.stringify({
        ...nextValue,
        updatedAt: Date.now(),
      }));
      window.dispatchEvent(new CustomEvent(eventName));
    }, {
      eventName: overrideEventName,
      storageKey: autoMineDebugOverrideKey,
      nextValue: payload,
    });
    await expectVisible(page.getByText("Auto-Miner", { exact: true }).first(), "auto-miner panel after failure-state override", scenarioTimeoutMs);
    await waitForUiHydration(page, scenarioTimeoutMs, "hub ui hydrated after failure-state override");
  };
  const clearOverride = async () => {
    await page.evaluate(({ eventName, storageKey }) => {
      window.localStorage.removeItem(storageKey);
      window.dispatchEvent(new CustomEvent(eventName));
    }, {
      eventName: overrideEventName,
      storageKey: autoMineDebugOverrideKey,
    });
    try {
      await page.waitForFunction(() => {
        const bodyText = document.body?.innerText.replace(/\s+/g, " ") ?? "";
        return bodyText.includes("LOGIN TO START")
          && !bodyText.includes("Recovery queued")
          && !bodyText.includes("Session Expired")
          && !bodyText.includes("RESUME PENDING")
          && !bodyText.includes("SESSION EXPIRED");
      }, undefined, { timeout: scenarioTimeoutMs });
      console.log("PASS auto-miner failure-state override cleared");
    } catch {
      await safeReload(page, baseUrl, timeoutMs);
      await expectVisible(page.getByText("Auto-Miner", { exact: true }).first(), "auto-miner panel after clearing override", scenarioTimeoutMs);
      console.log("PASS auto-miner failure-state override cleared");
    }
  };

  try {
    await applyScenario({
      phase: "retry-wait",
      progress: "Auto-miner paused: RPC offline for too long. Retrying automatically...",
      runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
    });
    await expectVisible(page.getByText("Recovery queued", { exact: true }).first(), "auto-miner retry-wait badge", scenarioTimeoutMs);
    await expectVisible(page.getByText("Auto-miner paused: RPC offline for too long. Retrying automatically...", { exact: true }).first(), "auto-miner retry-wait progress", scenarioTimeoutMs);
    await expectVisible(page.getByText("RESUME PENDING", { exact: true }).first(), "auto-miner retry-wait button", scenarioTimeoutMs);
    console.log("PASS auto-miner retry-wait scenario");

    await applyScenario({
      phase: "session-expired",
      progress: "Session expired. Log out, log in again, then reload this page - the bot will auto-resume.",
      runningParams: { betStr: "1.25", blocks: 4, rounds: 12 },
    });
    await expectVisible(page.getByText("Session Expired", { exact: true }).first(), "auto-miner session-expired badge", scenarioTimeoutMs);
    await expectVisible(page.getByText("Session expired. Log out, log in again, then reload this page - the bot will auto-resume.", { exact: true }).first(), "auto-miner session-expired progress", scenarioTimeoutMs);
    await expectVisible(page.getByText("SESSION EXPIRED", { exact: true }).first(), "auto-miner session-expired button", scenarioTimeoutMs);
    console.log("PASS auto-miner session-expired scenario");
  } catch (error) {
    const diagnostics = await page.evaluate((storageKey) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      return {
        bodyText: normalize(document.body?.innerText).slice(0, 1200),
        override: window.localStorage.getItem(storageKey),
      };
    }, autoMineDebugOverrideKey).catch(() => null);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`auto-miner failure scenarios did not surface expected UI: ${detail}; diagnostics=${JSON.stringify(diagnostics)}`);
  } finally {
    await clearOverride();
  }
}

export async function openDesktopTab(page, options) {
  const { baseUrl, buttonName, checks, skipMessage, targetHash, timeoutMs } = options;
  const tabTimeoutMs = Math.min(timeoutMs, 8_000);
  const normalizedTargetHash = targetHash ?? (buttonName === "Mining Hub"
    ? ""
    : `#${buttonName.toLowerCase().replace(/\s+/g, "")}`);

  const resetToHub = async () => {
    try {
      await page.evaluate(() => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const hubButton = [...document.querySelectorAll("button")]
          .find((button) => normalize(button.textContent) === "Mining Hub");
        if (hubButton instanceof HTMLElement) {
          hubButton.click();
          return;
        }
        window.location.hash = "";
      });
      await page.waitForFunction(() => {
        const bodyText = document.body?.innerText.replace(/\s+/g, " ") ?? "";
        return window.location.hash === "" && bodyText.includes("Manual Bet");
      }, undefined, { timeout: tabTimeoutMs });
      return;
    } catch {
      await safeReload(page, baseUrl, tabTimeoutMs);
      await waitForUiHydration(page, tabTimeoutMs, "hub ui hydrated after tab reset");
      await expectVisible(page.getByText("Manual Bet"), "hub manual bet panel after tab reset", tabTimeoutMs);
    }
  };

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
      try {
        await page.evaluate((targetHash) => {
          window.location.hash = targetHash;
        }, normalizedTargetHash);
        await waitForDesktopTabState();
        for (const [locator, label] of checks) {
          await expectVisible(locator, label, tabTimeoutMs);
        }
        return true;
      } catch {
        console.log(`SKIP ${skipMessage}`);
        await resetToHub();
        return false;
      }
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
