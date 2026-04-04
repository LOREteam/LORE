import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE_URL = process.env.CAPTURE_BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts", "jackpot-pages");

const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

async function findExecutablePath() {
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error("No Chrome/Edge executable found. Set SMOKE_BROWSER_EXECUTABLE.");
}

async function savePreviewVariant(browser, label, variant, fileName) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto(`${BASE_URL}/dev/jackpot-preview?variant=${variant}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const expectedTitle =
    variant === "weekly" ? "WEEKLY JACKPOT" : variant === "dual" ? "DOUBLE JACKPOT" : "DAILY JACKPOT";
  await page.getByText(expectedTitle).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1000);
  const target = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`Saved ${label}: ${target}`);
  await page.close();
}

async function saveJackpotWinPage(browser, fileName) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1100 },
    userAgent: "Twitterbot/1.0",
  });
  const page = await context.newPage();
  await page.goto(
    `${BASE_URL}/jackpot-win?kind=dual&amount=185.5&tile=3&epoch=1284&winner=0x1234567890abcdef1234567890abcdef12345678`,
    { waitUntil: "load", timeout: 30_000 },
  );
  await page.getByText("DOUBLE WINNER").waitFor({ state: "visible", timeout: 30_000 });
  const target = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`Saved jackpot-win: ${target}`);
  await context.close();
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const executablePath = await findExecutablePath();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  try {
    await savePreviewVariant(browser, "daily preview", "daily", "preview-daily.png");
    await savePreviewVariant(browser, "weekly preview", "weekly", "preview-weekly.png");
    await savePreviewVariant(browser, "dual preview", "dual", "preview-dual.png");
    await saveJackpotWinPage(browser, "jackpot-win.png");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
