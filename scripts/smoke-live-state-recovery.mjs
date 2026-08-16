import { chromium } from "playwright-core";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ensureLandingPage,
  findExecutablePath,
  warmBaseUrl,
} from "./smoke-browser-lib/core.mjs";
import {
  createRuntimePageErrorCounter,
  formatRuntimeSmokeError,
} from "./runtime-smoke-error-policy.mjs";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3004";
const TIMEOUT_MS = 90_000;
const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

function liveStatePayload(attempt) {
  const zeros = Array.from({ length: 25 }, () => "0");
  return {
    currentEpoch: "72",
    epochEndTime: String(Math.floor(Date.now() / 1000) + 60),
    jackpotInfo: Array.from({ length: 8 }, () => "0"),
    rolloverPool: "0",
    currentEpochData: ["0", "0", "0", false, false, false],
    tileData: { pools: zeros, users: zeros },
    tileUserCounts: Array.from({ length: 25 }, () => 0),
    indexedTilePools: zeros,
    epochDuration: "60",
    pendingEpochDuration: null,
    pendingEpochDurationEta: null,
    pendingEpochDurationEffectiveFromEpoch: null,
    fetchedAt: Date.now() + attempt,
  };
}

async function waitForAttemptCount(attempts, expected) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (attempts.length < expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (attempts.length < expected) {
    throw new Error(`live-state retry stalled at ${attempts.length}/${expected} attempts`);
  }
}

export async function runLiveStateRecoverySmoke() {
  await warmBaseUrl(BASE_URL, 30_000);
  const executablePath = await findExecutablePath(BROWSER_CANDIDATES);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const attempts = [];
  const pageErrors = createRuntimePageErrorCounter();

  page.on("pageerror", pageErrors.record);
  await page.route("**/api/live-state*", async (route) => {
    const attempt = attempts.length + 1;
    const offline = attempt >= 2 && attempt <= 6;
    attempts.push({ attempt, offline, at: Date.now() });
    await route.fulfill({
      status: offline ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(offline ? { error: "controlled offline drill" } : liveStatePayload(attempt)),
    });
  });

  try {
    await ensureLandingPage(page, { baseUrl: BASE_URL, timeoutMs: 30_000 });
    const chartLine = page.getByTestId("header-pool-chart-line");
    await chartLine.waitFor({ state: "attached", timeout: 30_000 });
    await waitForAttemptCount(attempts, 8);
    await chartLine.waitFor({ state: "attached", timeout: 5_000 });

    const lastTwo = attempts.slice(-2);
    if (lastTwo.some((attempt) => attempt.offline)) {
      throw new Error("live-state did not complete two successful reads after recovery");
    }
    const maxRetryGapMs = Math.max(
      ...attempts.slice(2, 7).map((attempt, index) => attempt.at - attempts[index + 1].at),
    );
    if (maxRetryGapMs > 23_000) {
      throw new Error(`live-state retry gap exceeded bound: ${maxRetryGapMs}ms`);
    }
    if (pageErrors.count() > 0) {
      throw new Error(`page errors during recovery drill: ${pageErrors.count()}`);
    }

    console.log(JSON.stringify({
      status: "PASS",
      attempts: attempts.length,
      controlledFailures: attempts.filter((attempt) => attempt.offline).length,
      recoverySuccesses: lastTwo.length,
      maxRetryGapMs,
      chartStayedMounted: true,
      pageErrors: pageErrors.count(),
    }));
  } finally {
    await browser.close();
  }
}

export async function runLiveStateRecoveryCli({
  run = runLiveStateRecoverySmoke,
  errorLog = console.error,
} = {}) {
  try {
    await run();
    return 0;
  } catch (error) {
    errorLog(formatRuntimeSmokeError(error));
    return 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  process.exitCode = await runLiveStateRecoveryCli();
}
