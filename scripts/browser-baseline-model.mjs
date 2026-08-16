import { redactProofText } from "./redact-proof-output.mjs";

export const MAX_BASELINE_DIAGNOSTIC_CHARS = 500;
export const MAX_API_LATENCY_SAMPLES_PER_PATH = 128;

const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function effectivePort(url) {
  if (url.port) return url.port;
  if (url.protocol === "http:") return "80";
  if (url.protocol === "https:") return "443";
  return "";
}

function asUrl(value, label) {
  try {
    return value instanceof URL ? value : new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
}

export function parseLoopbackBaselineUrl(value = "http://localhost:3000") {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error("BASELINE_BASE_URL must be a canonical loopback URL");
  }
  const url = asUrl(value, "BASELINE_BASE_URL");
  if (
    !["http:", "https:"].includes(url.protocol)
    || !LOOPBACK_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("BASELINE_BASE_URL must be a canonical loopback URL without credentials, query, or fragment");
  }
  return url;
}

export function parseCanonicalInteger(value, { fallback, min, max, name }) {
  const candidate = value === undefined || value === "" ? String(fallback) : value;
  if (typeof candidate !== "string" || !DECIMAL_INTEGER_RE.test(candidate)) {
    throw new Error(`${name} must be a canonical decimal integer between ${min} and ${max}`);
  }
  const parsed = BigInt(candidate);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be a canonical decimal integer between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`${name} must be a canonical decimal integer between ${min} and ${max}`);
  }
  return numeric;
}

export function parseBaselineViewport(value = "1440x900") {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error("BASELINE_VIEWPORT must use canonical WIDTHxHEIGHT dimensions");
  }
  const match = /^([1-9]\d{2,3})x([1-9]\d{2,3})$/.exec(value);
  if (!match) {
    throw new Error("BASELINE_VIEWPORT must use WIDTHxHEIGHT, for example 390x844");
  }
  const width = parseCanonicalInteger(match[1], {
    fallback: 1440,
    min: 320,
    max: 3840,
    name: "BASELINE_VIEWPORT width",
  });
  const height = parseCanonicalInteger(match[2], {
    fallback: 900,
    min: 320,
    max: 3840,
    name: "BASELINE_VIEWPORT height",
  });
  return { text: value, width, height };
}

export function parseBrowserBaselineConfig(env = {}) {
  const baseUrl = parseLoopbackBaselineUrl(env.BASELINE_BASE_URL || "http://localhost:3000");
  const viewport = parseBaselineViewport(env.BASELINE_VIEWPORT || "1440x900");
  return {
    baseUrl,
    observeMs: parseCanonicalInteger(env.BASELINE_OBSERVE_MS, {
      fallback: 10_000,
      min: 1_000,
      max: 900_000,
      name: "BASELINE_OBSERVE_MS",
    }),
    sampleMs: parseCanonicalInteger(env.BASELINE_SAMPLE_MS, {
      fallback: 30_000,
      min: 1_000,
      max: 60_000,
      name: "BASELINE_SAMPLE_MS",
    }),
    viewport,
  };
}

export function isBaselineLocalTarget(candidate, baselineUrl) {
  let target;
  let baseline;
  try {
    target = asUrl(candidate, "target");
    baseline = asUrl(baselineUrl, "baseline");
  } catch {
    return false;
  }
  if (target.origin === baseline.origin) return true;
  return LOOPBACK_HOSTS.has(target.hostname)
    && LOOPBACK_HOSTS.has(baseline.hostname)
    && target.protocol === baseline.protocol
    && effectivePort(target) === effectivePort(baseline);
}

export function roundBaselineNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export function sanitizeBaselineDiagnostic(value) {
  const text = redactProofText(value)
    .replace(/(?:https?|wss?):\/\/\S+/gi, "<url>")
    .replace(/nonce-[^'\s;]+/gi, "nonce-<redacted>")
    .replace(/sha256-[^'\s;]+/gi, "sha256-<redacted>")
    .replace(/0x[a-f0-9]{40,64}/gi, "<hex>")
    .replace(/\b[a-f0-9]{64}\b/gi, "<hex>")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_BASELINE_DIAGNOSTIC_CHARS) return text;
  return `${text.slice(0, MAX_BASELINE_DIAGNOSTIC_CHARS - 15)}...<truncated>`;
}

export function classifyBaselineConsoleError({ locationUrl, message }, baselineUrl) {
  let target = "unknown";
  let path;
  if (locationUrl) {
    try {
      const location = new URL(locationUrl);
      target = isBaselineLocalTarget(location, baselineUrl) ? "local" : "external";
      if (target === "local") path = location.pathname;
    } catch {
      target = "unknown";
    }
  }
  const text = String(message ?? "");
  const kind = /content security policy|violates the following/i.test(text)
    ? "csp"
    : /failed to load resource|net::err/i.test(text)
      ? "resource"
      : /react|hydration/i.test(text)
        ? "react"
        : /wallet|privy|wagmi|connector/i.test(text)
          ? "wallet"
          : "other";
  return { kind, target, path, message: sanitizeBaselineDiagnostic(text) };
}

export function classifyExpectedBaselineAbort(failure, baselineUrl) {
  let url;
  const baseUrl = asUrl(baselineUrl, "baseline");
  try {
    url = asUrl(failure.url, "request");
  } catch {
    return null;
  }
  if (!isBaselineLocalTarget(url, baseUrl)) return null;
  const method = String(failure.method || "").toUpperCase();
  const resourceType = String(failure.resourceType || "");
  const error = sanitizeBaselineDiagnostic(failure.error || "unknown");
  const headers = failure.headers && typeof failure.headers === "object" ? failure.headers : {};
  const isAbortedFetch = resourceType === "fetch" && error === "net::ERR_ABORTED";
  if (
    method === "GET"
    && isAbortedFetch
    && !url.pathname.startsWith("/api/")
    && (headers.rsc === "1" || url.searchParams.has("_rsc"))
  ) return "rsc";
  if (
    method === "HEAD"
    && isAbortedFetch
    && url.pathname === baseUrl.pathname
    && url.search === ""
  ) return "wallet-coop";
  if (
    method === "GET"
    && isAbortedFetch
    && url.pathname === "/api/chat/messages"
    && url.search === ""
  ) return "chat-poll";
  if (
    method === "GET"
    && isAbortedFetch
    && url.pathname === "/api/recent-wins"
    && url.search === ""
  ) return "recent-wins-poll";
  return null;
}

export function addBoundedLatencySample(samplesByPath, path, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return false;
  const samples = samplesByPath.get(path) || [];
  if (samples.length >= MAX_API_LATENCY_SAMPLES_PER_PATH) return false;
  samples.push(durationMs);
  samplesByPath.set(path, samples);
  return true;
}

export function summarizeLatencySamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const percentileIndex = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    samples: sorted.length,
    minMs: roundBaselineNumber(sorted[0]),
    meanMs: roundBaselineNumber(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p95Ms: roundBaselineNumber(sorted[percentileIndex]),
    maxMs: roundBaselineNumber(sorted.at(-1)),
  };
}

export function deriveBaselineQuality({
  failedLocalResponseCount = 0,
  localRequestFailureCount = 0,
  consoleErrorsByTarget = {},
}) {
  const localConsoleErrorCount = consoleErrorsByTarget.local || 0;
  const unknownConsoleErrorCount = consoleErrorsByTarget.unknown || 0;
  const issues = [];
  if (failedLocalResponseCount > 0) issues.push(`${failedLocalResponseCount} failed local response(s)`);
  if (localRequestFailureCount > 0) issues.push(`${localRequestFailureCount} failed local request(s)`);
  if (localConsoleErrorCount > 0) issues.push(`${localConsoleErrorCount} local console error(s)`);
  if (unknownConsoleErrorCount > 0) issues.push(`${unknownConsoleErrorCount} unknown-target console error(s)`);
  return { status: issues.length === 0 ? "pass" : "degraded", issues };
}

export function buildBrowserBaselineSummary(report) {
  return {
    schemaVersion: report.schemaVersion,
    startedAt: report.startedAt,
    target: report.target,
    observationMs: report.observationMs,
    quality: report.quality,
    vitals: report.vitals,
    resources: {
      count: report.resources.count,
      transferredBytes: report.resources.transferredBytes,
      decodedBytes: report.resources.decodedBytes,
      byType: report.resources.byType,
    },
    requests: {
      sameOriginApiCount: report.requests.sameOriginApiCount,
      sameOriginApiPerMinute: report.requests.sameOriginApiPerMinute,
      sameOriginApiResponseLatencyByPath: report.requests.sameOriginApiResponseLatencyByPath,
      externalFetchCount: report.requests.externalFetchCount,
      failedLocalResponseCount: report.requests.failedLocalResponseCount,
      failedExternalResponseCount: report.requests.failedExternalResponseCount,
      requestFailureCount: report.requests.requestFailureCount,
      localRequestFailureCount: report.requests.localRequestFailureCount,
      externalRequestFailureCount: report.requests.externalRequestFailureCount,
      ignoredLocalRscAbortCount: report.requests.ignoredLocalRscAbortCount,
      ignoredLocalWalletCoopAbortCount: report.requests.ignoredLocalWalletCoopAbortCount,
      ignoredLocalChatPollAbortCount: report.requests.ignoredLocalChatPollAbortCount,
      ignoredLocalRecentWinsPollAbortCount: report.requests.ignoredLocalRecentWinsPollAbortCount,
    },
    runtime: {
      initialDomNodes: report.runtime.initialDomNodes,
      domNodes: report.runtime.domNodes,
      domNodeDelta: report.runtime.domNodeDelta,
      jsHeapUsedBytes: report.runtime.jsHeapUsedBytes,
      jsHeapUsedDeltaBytes: report.runtime.jsHeapUsedDeltaBytes,
      maxJsHeapUsedBytes: report.runtime.maxJsHeapUsedBytes,
      jsHeapPeakDeltaBytes: report.runtime.jsHeapPeakDeltaBytes,
      maxDomNodes: report.runtime.maxDomNodes,
      domNodePeakDelta: report.runtime.domNodePeakDelta,
      sampleCount: report.runtime.samples.length,
      longTaskCount: report.runtime.longTaskCount,
      longTaskTotalMs: report.runtime.longTaskTotalMs,
      longestTaskMs: report.runtime.longestTaskMs,
      consoleErrorCount: report.runtime.consoleErrorCount,
      consoleErrorsByKind: report.runtime.consoleErrorsByKind,
      consoleErrorsByTarget: report.runtime.consoleErrorsByTarget,
    },
  };
}

export function planBrowserBaselinePublication(report, { summaryOnly }) {
  const published = summaryOnly ? buildBrowserBaselineSummary(report) : report;
  return {
    consoleText: JSON.stringify(published, null, 2),
    artifactText: summaryOnly ? null : `${JSON.stringify(report, null, 2)}\n`,
    shouldWriteArtifact: !summaryOnly,
  };
}

export function installBrowserBaselineObservers(scope = globalThis) {
  scope.__lorePerformanceBaseline = {
    cls: 0,
    inp: 0,
    inpEvent: null,
    lcp: 0,
    lcpElement: null,
    longTasks: [],
  };
  const observe = (callback, options) => {
    try {
      new scope.PerformanceObserver(callback).observe(options);
    } catch {
      // Individual performance entry types are optional across browser versions.
    }
  };
  observe((list) => {
    for (const entry of list.getEntries()) {
      scope.__lorePerformanceBaseline.lcp = entry.startTime;
      const element = entry.element;
      scope.__lorePerformanceBaseline.lcpElement = element
        ? {
            tag: element.tagName.toLowerCase(),
            id: element.id.slice(0, 80) || null,
            className: typeof element.className === "string" ? element.className.slice(0, 160) || null : null,
          }
        : null;
    }
  }, { type: "largest-contentful-paint", buffered: true });
  observe((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) scope.__lorePerformanceBaseline.cls += entry.value;
    }
  }, { type: "layout-shift", buffered: true });
  observe((list) => {
    for (const entry of list.getEntries()) scope.__lorePerformanceBaseline.longTasks.push(entry.duration);
  }, { type: "longtask", buffered: true });
  observe((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.interactionId || entry.duration <= scope.__lorePerformanceBaseline.inp) continue;
      scope.__lorePerformanceBaseline.inp = entry.duration;
      scope.__lorePerformanceBaseline.inpEvent = entry.name;
    }
  }, { type: "event", buffered: true, durationThreshold: 16 });
}

export async function triggerSyntheticSoundToggle(page) {
  const soundToggle = page.getByRole("button", { name: /Mute sounds|Unmute sounds/ });
  if (!await soundToggle.isVisible().catch(() => false)) return false;
  await soundToggle.click();
  return true;
}

export function describeSyntheticInteraction(performed) {
  return performed
    ? "Synthetic sound-toggle interaction; local lab value, not field INP."
    : "Not collected because the sound toggle was unavailable.";
}
