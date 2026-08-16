import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { findExecutablePath, warmBaseUrl } from "./smoke-browser-lib/core.mjs";
import {
  addBoundedLatencySample,
  classifyBaselineConsoleError,
  classifyExpectedBaselineAbort,
  deriveBaselineQuality,
  describeSyntheticInteraction,
  installBrowserBaselineObservers,
  isBaselineLocalTarget,
  parseBrowserBaselineConfig,
  planBrowserBaselinePublication,
  roundBaselineNumber,
  sanitizeBaselineDiagnostic,
  summarizeLatencySamples,
  triggerSyntheticSoundToggle,
} from "./browser-baseline-model.mjs";

export async function collectBrowserBaseline({
  env = process.env,
  baselineConfig = parseBrowserBaselineConfig(env),
} = {}) {
  const BASE_URL = baselineConfig.baseUrl.href;
  const OBSERVE_MS = baselineConfig.observeMs;
  const SAMPLE_MS = baselineConfig.sampleMs;
  const VIEWPORT_TEXT = baselineConfig.viewport.text;
  const viewport = {
    width: baselineConfig.viewport.width,
    height: baselineConfig.viewport.height,
  };
  const browserCandidates = [
    env.SMOKE_BROWSER_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

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
  const apiRequestStartedAt = new WeakMap();
  const apiResponseLatencyByPath = new Map();
  const jsonRpcMethodCounts = new Map();
  const resourceTypeCounts = new Map();
  let externalFetchCount = 0;
  let failedLocalResponseCount = 0;
  let failedExternalResponseCount = 0;
  let requestFailureCount = 0;
  let localRequestFailureCount = 0;
  let externalRequestFailureCount = 0;
  let ignoredLocalRscAbortCount = 0;
  let ignoredLocalWalletCoopAbortCount = 0;
  let ignoredLocalChatPollAbortCount = 0;
  let ignoredLocalRecentWinsPollAbortCount = 0;
  const consoleErrorKinds = new Map();
  const consoleErrorTargets = new Map();
  const consoleErrorSamples = [];
  const requestFailureSamples = [];

  const isLocalTarget = (url) => isBaselineLocalTarget(url, baseUrl);

  const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  await page.addInitScript(installBrowserBaselineObservers);

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const diagnostic = classifyBaselineConsoleError({
      locationUrl: message.location().url,
      message: message.text(),
    }, baseUrl);
    increment(consoleErrorKinds, diagnostic.kind);
    increment(consoleErrorTargets, diagnostic.target);
    if (consoleErrorSamples.length < 5) {
      consoleErrorSamples.push(diagnostic);
    }
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
      apiRequestStartedAt.set(request, Date.now());
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
    const url = new URL(response.url());
    const request = response.request();
    const requestStartedAt = apiRequestStartedAt.get(request);
    if (isLocalTarget(url) && url.pathname.startsWith("/api/") && requestStartedAt !== undefined) {
      addBoundedLatencySample(apiResponseLatencyByPath, url.pathname, Date.now() - requestStartedAt);
      apiRequestStartedAt.delete(request);
    }
    if (response.status() < 400) return;
    if (isLocalTarget(url)) failedLocalResponseCount += 1;
    else failedExternalResponseCount += 1;
  });
  page.on("requestfailed", (request) => {
    apiRequestStartedAt.delete(request);
    const url = new URL(request.url());
    const target = isLocalTarget(url) ? "local" : "external";
    const error = sanitizeBaselineDiagnostic(request.failure()?.errorText || "unknown");
    const expectedAbort = classifyExpectedBaselineAbort({
      url,
      method: request.method(),
      resourceType: request.resourceType(),
      headers: request.headers(),
      error,
    }, baseUrl);
    if (expectedAbort === "rsc") {
      ignoredLocalRscAbortCount += 1;
      return;
    }
    if (expectedAbort === "wallet-coop") {
      // Coinbase Wallet SDK probes the current page's COOP header with HEAD.
      ignoredLocalWalletCoopAbortCount += 1;
      return;
    }
    if (expectedAbort === "chat-poll") {
      // React dev cleanup can abort the stale chat poll; keep it visible without degrading the page.
      ignoredLocalChatPollAbortCount += 1;
      return;
    }
    if (expectedAbort === "recent-wins-poll") {
      // React dev cleanup can abort the stale recent-wins poll; keep it visible without degrading the page.
      ignoredLocalRecentWinsPollAbortCount += 1;
      return;
    }

    requestFailureCount += 1;
    if (target === "local") localRequestFailureCount += 1;
    else externalRequestFailureCount += 1;
    if (requestFailureSamples.length < 5) {
      const headers = request.headers();
      requestFailureSamples.push({
        target,
        path: target === "local" ? url.pathname : undefined,
        method: request.method(),
        resourceType: request.resourceType(),
        error,
        ...(target === "local"
          ? {
              hasRscHeader: headers.rsc === "1",
              hasRscQuery: url.searchParams.has("_rsc"),
              hasRouterStateHeader: Boolean(headers["next-router-state-tree"]),
              hasRouterPrefetchHeader: headers["next-router-prefetch"] === "1",
            }
          : {}),
      });
    }
  });

  const startedAt = new Date().toISOString();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const interactionDelayMs = Math.min(2_500, Math.max(500, Math.floor(OBSERVE_MS / 4)));
  await page.waitForTimeout(interactionDelayMs);
  const syntheticInteraction = await triggerSyntheticSoundToggle(page);
  const readRuntimeSnapshot = () => page.evaluate(() => ({
    domNodes: document.getElementsByTagName("*").length,
    jsHeapUsedBytes: performance.memory?.usedJSHeapSize ?? null,
  }));
  const initialRuntime = await readRuntimeSnapshot();
  const runtimeSamples = [{ elapsedMs: interactionDelayMs, ...initialRuntime }];
  const remainingObservationMs = Math.max(0, OBSERVE_MS - interactionDelayMs);
  const samplingStartedAt = Date.now();
  while (Date.now() - samplingStartedAt < remainingObservationMs) {
    const elapsedMs = Date.now() - samplingStartedAt;
    await page.waitForTimeout(Math.min(SAMPLE_MS, remainingObservationMs - elapsedMs));
    runtimeSamples.push({
      elapsedMs: Math.min(OBSERVE_MS, interactionDelayMs + Date.now() - samplingStartedAt),
      ...await readRuntimeSnapshot(),
    });
  }

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
  const finalRuntimeSample = {
    elapsedMs: OBSERVE_MS,
    domNodes: metrics.domNodes,
    jsHeapUsedBytes: metrics.jsHeapUsedBytes,
  };
  if (runtimeSamples.at(-1)?.elapsedMs !== OBSERVE_MS) runtimeSamples.push(finalRuntimeSample);
  const heapSamples = runtimeSamples
    .map((sample) => sample.jsHeapUsedBytes)
    .filter((value) => Number.isFinite(value));
  const maxJsHeapUsedBytes = heapSamples.length > 0 ? Math.max(...heapSamples) : null;
  const maxDomNodes = Math.max(...runtimeSamples.map((sample) => sample.domNodes));
  const quality = deriveBaselineQuality({
    failedLocalResponseCount,
    localRequestFailureCount,
    consoleErrorsByTarget: Object.fromEntries(consoleErrorTargets),
  });
  const report = {
    schemaVersion: 1,
    startedAt,
    target: { kind: "local", origin: baseOrigin, viewport: VIEWPORT_TEXT },
    observationMs: OBSERVE_MS,
    quality,
    vitals: {
      fcpMs: roundBaselineNumber(metrics.fcp),
      lcpMs: roundBaselineNumber(metrics.lcp),
      lcpElement: metrics.lcpElement,
      cls: roundBaselineNumber(metrics.cls),
      inpMs: metrics.inp > 0 ? roundBaselineNumber(metrics.inp) : null,
      inpEvent: metrics.inpEvent,
      inpNote: describeSyntheticInteraction(syntheticInteraction),
    },
    navigation: {
      ttfbMs: roundBaselineNumber(metrics.navigation?.ttfb),
      domContentLoadedMs: roundBaselineNumber(metrics.navigation?.domContentLoaded),
      loadMs: roundBaselineNumber(metrics.navigation?.load),
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
      sameOriginApiPerMinute: roundBaselineNumber(
        ([...apiCounts.values()].reduce((sum, count) => sum + count, 0) * 60_000) / OBSERVE_MS,
      ),
      sameOriginApiByPath: Object.fromEntries([...apiCounts.entries()].sort()),
      sameOriginApiResponseLatencyByPath: Object.fromEntries(
        [...apiResponseLatencyByPath.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([path, samples]) => [path, summarizeLatencySamples(samples)]),
      ),
      externalFetchCount,
      externalJsonRpcByMethod: Object.fromEntries([...jsonRpcMethodCounts.entries()].sort()),
      failedLocalResponseCount,
      failedExternalResponseCount,
      requestFailureCount,
      localRequestFailureCount,
      externalRequestFailureCount,
      ignoredLocalRscAbortCount,
      ignoredLocalWalletCoopAbortCount,
      ignoredLocalChatPollAbortCount,
      ignoredLocalRecentWinsPollAbortCount,
      requestFailureSamples,
    },
    runtime: {
      initialDomNodes: initialRuntime.domNodes,
      domNodes: metrics.domNodes,
      domNodeDelta: metrics.domNodes - initialRuntime.domNodes,
      initialJsHeapUsedBytes: initialRuntime.jsHeapUsedBytes,
      jsHeapUsedBytes: metrics.jsHeapUsedBytes,
      jsHeapUsedDeltaBytes:
        metrics.jsHeapUsedBytes == null || initialRuntime.jsHeapUsedBytes == null
          ? null
          : metrics.jsHeapUsedBytes - initialRuntime.jsHeapUsedBytes,
      maxJsHeapUsedBytes,
      jsHeapPeakDeltaBytes:
        maxJsHeapUsedBytes == null || initialRuntime.jsHeapUsedBytes == null
          ? null
          : maxJsHeapUsedBytes - initialRuntime.jsHeapUsedBytes,
      jsHeapTotalBytes: metrics.jsHeapTotalBytes,
      maxDomNodes,
      domNodePeakDelta: maxDomNodes - initialRuntime.domNodes,
      sampleIntervalMs: SAMPLE_MS,
      samples: runtimeSamples,
      longTaskCount: longTasks.length,
      longTaskTotalMs: roundBaselineNumber(longTasks.reduce((sum, duration) => sum + duration, 0)),
      longestTaskMs: roundBaselineNumber(Math.max(0, ...longTasks)),
      consoleErrorCount: [...consoleErrorKinds.values()].reduce((sum, count) => sum + count, 0),
      consoleErrorsByKind: Object.fromEntries([...consoleErrorKinds.entries()].sort()),
      consoleErrorsByTarget: Object.fromEntries([...consoleErrorTargets.entries()].sort()),
      consoleErrorSamples,
    },
  };

    await context.close();
    return report;
  } finally {
    await browser.close();
  }
}

export async function runBrowserBaselineCli({
  env = process.env,
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  collectBrowserBaselineFn = collectBrowserBaseline,
  fsApi = fs,
  log = console.log,
} = {}) {
  const baselineConfig = parseBrowserBaselineConfig(env);
  const summaryOnly = argv.includes("--summary-only");
  const outputPath = path.resolve(
    cwd,
    env.BASELINE_OUT || "artifacts/performance/browser-baseline.json",
  );
  const report = await collectBrowserBaselineFn({ baselineConfig, env });
  const publication = planBrowserBaselinePublication(report, { summaryOnly });
  if (publication.shouldWriteArtifact) {
    await fsApi.mkdir(path.dirname(outputPath), { recursive: true });
    await fsApi.writeFile(outputPath, publication.artifactText, "utf8");
  }
  log(publication.consoleText);
  if (publication.shouldWriteArtifact) {
    log(`Browser baseline written: ${path.relative(cwd, outputPath)}`);
  }
  return { outputPath, publication, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBrowserBaselineCli();
}
