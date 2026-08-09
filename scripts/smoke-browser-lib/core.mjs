import fs from "node:fs/promises";

const MAX_WARMUP_RESPONSE_BYTES = 1024 * 1024;
const CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export async function findExecutablePath(browserCandidates) {
  for (const candidate of browserCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("no Chrome/Edge executable found; set SMOKE_BROWSER_EXECUTABLE");
}

export async function expectVisible(locator, label, timeoutMs) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  console.log(`PASS ${label}`);
}

export async function waitForUiHydration(page, timeoutMs, label = "ui hydration") {
  try {
    await page.locator("[data-ui-hydrated='true']").first().waitFor({ state: "attached", timeout: timeoutMs });
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
        || bodyText.includes("Login / Connect")
        || bodyText.includes("Connect Wallet");
      return hasPrimaryNav && hasHubSurface;
    }, undefined, { timeout: Math.min(timeoutMs, 20_000) });
  }
  console.log(`PASS ${label}`);
}

export async function saveSmokeScreenshot(page, screenshotPath) {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10_000 });
    console.log(`Saved screenshot: ${screenshotPath}`);
  } catch {
    console.log("SKIP screenshot capture (page stayed interactive but screenshot timed out)");
  }
}

export async function safeGoto(page, baseUrl, timeoutMs) {
  const navigationTimeoutMs = Math.min(timeoutMs, 10_000);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  } catch {
    try {
      await page.goto(baseUrl, { waitUntil: "load", timeout: navigationTimeoutMs });
    } catch {
      try {
        await page.goto(baseUrl, { waitUntil: "commit", timeout: navigationTimeoutMs });
      } catch (error) {
        const currentUrl = page.url();
        if (!currentUrl.startsWith(baseUrl)) throw error;
      }
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: Math.min(5_000, timeoutMs) });
      } catch {
        // fall through; the smoke assertions below will verify the real UI state
      }
    }
  }
}

export async function safeReload(page, baseUrl, timeoutMs) {
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch {
    await safeGoto(page, baseUrl, timeoutMs);
  }
}

async function readBoundedWarmupText(response) {
  const contentLength = parseContentLengthHeader(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_WARMUP_RESPONSE_BYTES) {
    throw new Error("warmup response body too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_WARMUP_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("warmup response body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseContentLengthHeader(value) {
  if (value == null || value === "") return null;
  if (!CONTENT_LENGTH_RE.test(value)) throw new Error("warmup response has invalid content-length");
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error("warmup response has invalid content-length");
  return Number(parsed);
}

export async function warmBaseUrl(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const requestTimeoutMs = Math.max(15_000, remainingMs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(baseUrl, {
        method: "GET",
        headers: { accept: "text/html" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`warmup returned ${response.status}`);
      }
      await readBoundedWarmupText(response);
      console.log(`PASS warmup ${baseUrl}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`failed to warm ${baseUrl} within ${timeoutMs}ms: ${detail}`);
}

export async function ensureLandingPage(page, options) {
  const { baseUrl, timeoutMs } = options;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await safeGoto(page, baseUrl, timeoutMs);
      await waitForUiHydration(page, timeoutMs);
      return;
    } catch {
      if (attempt === 3) throw new Error(`failed to open ${baseUrl} after ${attempt} attempts`);
      await page.waitForTimeout(2000 * attempt);
    }
  }
}

export function isTransientNavigationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Execution context was destroyed")
    || message.includes("most likely because of a navigation")
    || message.includes("Target page, context or browser has been closed");
}
