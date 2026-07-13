import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { findExecutablePath, warmBaseUrl } from "./smoke-browser-lib/core.mjs";

const BASE_URL = process.env.BASELINE_BASE_URL || "http://localhost:3000";
const OBSERVE_MS = Number.parseInt(process.env.BASELINE_OBSERVE_MS || "10000", 10);
const VIEWPORT_TEXT = process.env.BASELINE_VIEWPORT || "1440x900";
const OUTPUT_PATH = path.resolve(
  process.env.BASELINE_OUT || "artifacts/performance/browser-baseline.json",
);

if (!Number.isFinite(OBSERVE_MS) || OBSERVE_MS < 1_000 || OBSERVE_MS > 120_000) {
  throw new Error("BASELINE_OBSERVE_MS must be between 1000 and 120000");
}

const viewportMatch = /^(\d{3,4})x(\d{3,4})$/.exec(VIEWPORT_TEXT);
if (!viewportMatch) {
  throw new Error("BASELINE_VIEWPORT must use WIDTHxHEIGHT, for example 390x844");
}
const viewport = {
  width: Number.parseInt(viewportMatch[1], 10),
  height: Number.parseInt(viewportMatch[2], 10),
};
if (viewport.width < 320 || viewport.width > 3840 || viewport.height < 320 || viewport.height > 3840) {
  throw new Error("BASELINE_VIEWPORT dimensions must be between 320 and 3840 pixels");
}

const browserCandidates = [
  process.env.SMOKE_BROWSER_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);

await warmBaseUrl(BASE_URL, 90_000);
const executablePath = await findExecutablePath(browserCandidates);
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const baseOrigin = new URL(BASE_URL).origin;
  const baseUrl = new URL(BASE_URL);
  const apiCounts = new Map();
  const jsonRpcMethodCounts = new Map();
  const resourceTypeCounts = new Map();
  let externalFetchCount = 0;
  let failedLocalResponseCount = 0;
  let failedExternalResponseCount = 0;
  let requestFailureCount = 0;
  const consoleErrorKinds = new Map();

  const isLocalTarget = (url) => {
    if (url.origin === baseOrigin) return true;
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    return loopbackHosts.has(url.hostname) && loopbackHosts.has(baseUrl.hostname) && url.port === baseUrl.port;
  };

  const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  await page.addInitScript(() => {
    window.__lorePerformanceBaseline = { cls: 0, inp: 0, inpEvent: null, lcp: 0, lcpElement: null, longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__lorePerformanceBaseline.lcp = entry.startTime;
        const element = entry.element;
        window.__lorePerformanceBaseline.lcpElement = element
          ? {
              tag: element.tagName.toLowerCase(),
              id: element.id.slice(0, 80) || null,
              className: typeof element.className === "string" ? element.className.slice(0, 160) || null : null,
            }
          : null;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__lorePerformanceBaseline.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__lorePerformanceBaseline.longTasks.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.interactionId || entry.duration <= window.__lorePerformanceBaseline.inp) continue;
        window.__lorePerformanceBaseline.inp = entry.duration;
        window.__lorePerformanceBaseline.inpEvent = entry.name;
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const kind = /content security policy|violates the following/i.test(text)
      ? "csp"
      : /failed to load resource|net::err/i.test(text)
        ? "resource"
        : /react|hydration/i.test(text)
          ? "react"
          : /wallet|privy|wagmi|connector/i.test(text)
            ? "wallet"
            : "other";
    increment(consoleErrorKinds, kind);
  });
  page.on("request", (request) => {
    resourceTypeCounts.set(
      request.resourceType(),
      (resourceTypeCounts.get(request.resourceType()) || 0) + 1,
    );
    if (!['fetch', 'xhr'].includes(request.resourceType())) return;
    const url = new URL(request.url());
    if (isLocalTarget(url) && url.pathname.startsWith("/api/")) {
      increment(apiCounts, url.pathname);
    } else if (!isLocalTarget(url)) {
      externalFetchCount += 1;
      try {
        const payload = request.postDataJSON();
        const entries = Array.isArray(payload) ? payload : [payload];
        for (const entry of entries) {
          if (entry && typeof entry.method === "string" && /^eth_|^net_|^web3_/i.test(entry.method)) {
            increment(jsonRpcMethodCounts, entry.method);
          }
        }
      } catch {
        // Non-JSON external request. Count only the request, never its URL or payload.
      }
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (isLocalTarget(url)) failedLocalResponseCount += 1;
    else failedExternalResponseCount += 1;
  });
  page.on("requestfailed", () => {
    requestFailureCount += 1;
  });

  const startedAt = new Date().toISOString();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const interactionDelayMs = Math.min(2_500, Math.max(500, Math.floor(OBSERVE_MS / 4)));
  await page.waitForTimeout(interactionDelayMs);
  const soundToggle = page.getByRole("button", { name: /Mute sounds|Unmute sounds/ });
  let syntheticInteraction = false;
  if (await soundToggle.isVisible().catch(() => false)) {
    await soundToggle.click();
    syntheticInteraction = true;
  }
  await page.waitForTimeout(Math.max(0, OBSERVE_MS - interactionDelayMs));

  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const paints = Object.fromEntries(
      performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]),
    );
    const resources = performance.getEntriesByType("resource");
    const memory = performance.memory;
    return {
      navigation: navigation
        ? {
            ttfb: navigation.responseStart,
            domContentLoaded: navigation.domContentLoadedEventEnd,
            load: navigation.loadEventEnd,
            transferredBytes: navigation.transferSize,
          }
        : null,
      fcp: paints["first-contentful-paint"] ?? null,
      lcp: window.__lorePerformanceBaseline?.lcp ?? null,
      lcpElement: window.__lorePerformanceBaseline?.lcpElement ?? null,
      cls: window.__lorePerformanceBaseline?.cls ?? null,
      inp: window.__lorePerformanceBaseline?.inp ?? null,
      inpEvent: window.__lorePerformanceBaseline?.inpEvent ?? null,
      longTasks: window.__lorePerformanceBaseline?.longTasks ?? [],
      resourceCount: resources.length,
      resourceTransferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      resourceDecodedBytes: resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      resourceDetails: resources.map((entry) => ({
        name: entry.name,
        type: entry.initiatorType,
        transferBytes: entry.transferSize || 0,
        decodedBytes: entry.decodedBodySize || 0,
      })),
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      domNodes: document.getElementsByTagName("*").length,
      jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: memory?.totalJSHeapSize ?? null,
    };
  });

  const longTasks = metrics.longTasks;
  const report = {
    schemaVersion: 1,
    startedAt,
    target: { kind: "local", origin: baseOrigin, viewport: VIEWPORT_TEXT },
    observationMs: OBSERVE_MS,
    vitals: {
      fcpMs: round(metrics.fcp),
      lcpMs: round(metrics.lcp),
      lcpElement: metrics.lcpElement,
      cls: round(metrics.cls),
      inpMs: metrics.inp > 0 ? round(metrics.inp) : null,
      inpEvent: metrics.inpEvent,
      inpNote: syntheticInteraction
        ? "Synthetic sound-toggle interaction; local lab value, not field INP."
        : "Not collected because the sound toggle was unavailable.",
    },
    navigation: {
      ttfbMs: round(metrics.navigation?.ttfb),
      domContentLoadedMs: round(metrics.navigation?.domContentLoaded),
      loadMs: round(metrics.navigation?.load),
      transferredBytes: metrics.navigation?.transferredBytes ?? null,
    },
    layout: {
      viewportWidth: metrics.viewportWidth,
      documentScrollWidth: metrics.documentScrollWidth,
      horizontalOverflowPx: Math.max(0, metrics.documentScrollWidth - metrics.viewportWidth),
    },
    resources: {
      count: metrics.resourceCount,
      transferredBytes: metrics.resourceTransferBytes,
      decodedBytes: metrics.resourceDecodedBytes,
      byType: Object.fromEntries([...resourceTypeCounts.entries()].sort()),
      largestLocal: metrics.resourceDetails
        .filter((entry) => isLocalTarget(new URL(entry.name)))
        .sort((a, b) => b.transferBytes - a.transferBytes)
        .slice(0, 12)
        .map((entry) => ({
          path: new URL(entry.name).pathname,
          type: entry.type,
          transferBytes: entry.transferBytes,
          decodedBytes: entry.decodedBytes,
        })),
    },
    requests: {
      sameOriginApiCount: [...apiCounts.values()].reduce((sum, count) => sum + count, 0),
      sameOriginApiByPath: Object.fromEntries([...apiCounts.entries()].sort()),
      externalFetchCount,
      externalJsonRpcByMethod: Object.fromEntries([...jsonRpcMethodCounts.entries()].sort()),
      failedLocalResponseCount,
      failedExternalResponseCount,
      requestFailureCount,
    },
    runtime: {
      domNodes: metrics.domNodes,
      jsHeapUsedBytes: metrics.jsHeapUsedBytes,
      jsHeapTotalBytes: metrics.jsHeapTotalBytes,
      longTaskCount: longTasks.length,
      longTaskTotalMs: round(longTasks.reduce((sum, duration) => sum + duration, 0)),
      longestTaskMs: round(Math.max(0, ...longTasks)),
      consoleErrorCount: [...consoleErrorKinds.values()].reduce((sum, count) => sum + count, 0),
      consoleErrorsByKind: Object.fromEntries([...consoleErrorKinds.entries()].sort()),
    },
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Browser baseline written: ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  await context.close();
} finally {
  await browser.close();
}
