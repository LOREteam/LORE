import { sanitizeSentryPayload } from "../../lib/sentrySanitize";

type RouteMetricState = {
  requests: number;
  successes: number;
  errors: number;
  cacheHits: number;
  staleServed: number;
  inflightJoined: number;
  backgroundRefreshes: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number;
  maxLatencyMs: number;
  lastStatus: number | null;
  lastRequestAt: number | null;
  lastErrorAt: number | null;
  inflight: number;
};

type RouteMetricToken = {
  route: string;
  startedAt: number;
  completed: boolean;
};

type RuntimeMetricsGlobal = typeof globalThis & {
  __loreRuntimeMetrics__?: Map<string, RouteMetricState>;
};

const MAX_ROUTE_METRIC_ENTRIES = 128;
const MAX_ROUTE_METRIC_KEY_LENGTH = 120;
const MAX_ROUTE_METRIC_COUNT = Number.MAX_SAFE_INTEGER;
const MAX_RUNTIME_PROCESS_METRIC = Number.MAX_SAFE_INTEGER;
const ROUTE_METRIC_LATENCY_MAX_MS = 24 * 60 * 60 * 1000;
const OVERFLOW_ROUTE_METRIC_KEY = "__overflow__";
const UNKNOWN_ROUTE_METRIC_KEY = "unknown";
const ROUTE_METRIC_KEY_ALLOWED = /[^a-z0-9/_:-]+/gi;

const runtimeMetricsGlobal = globalThis as RuntimeMetricsGlobal;
const routeMetrics =
  runtimeMetricsGlobal.__loreRuntimeMetrics__ ??
  (runtimeMetricsGlobal.__loreRuntimeMetrics__ = new Map<string, RouteMetricState>());

function normalizeRouteMetricLatencyMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, ROUTE_METRIC_LATENCY_MAX_MS);
}

function formatRouteMetricAverageLatencyMs(value: number): number {
  return Number(normalizeRouteMetricLatencyMs(value).toFixed(2));
}

function incrementRouteMetricCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(value + 1, MAX_ROUTE_METRIC_COUNT)
    : 1;
}

function normalizeRouteMetricStatus(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : fallback;
}

function normalizeRuntimeProcessMetric(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > MAX_RUNTIME_PROCESS_METRIC) return MAX_RUNTIME_PROCESS_METRIC;
  return Number.isSafeInteger(value) ? value : 0;
}

function normalizeRuntimeProcessUptimeSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > MAX_RUNTIME_PROCESS_METRIC) return MAX_RUNTIME_PROCESS_METRIC;
  return Math.floor(value);
}

function normalizeRouteMetricKey(route: string) {
  const safeRoute = sanitizeSentryPayload(route);
  const routeLabel = typeof safeRoute === "string" ? safeRoute : UNKNOWN_ROUTE_METRIC_KEY;
  const normalized = routeLabel
    .replace(ROUTE_METRIC_KEY_ALLOWED, "-")
    .slice(0, MAX_ROUTE_METRIC_KEY_LENGTH)
    .replace(/^-+|-+$/g, "");
  return normalized || UNKNOWN_ROUTE_METRIC_KEY;
}

function selectRouteMetricKey(route: string) {
  const key = normalizeRouteMetricKey(route);
  if (routeMetrics.has(key) || routeMetrics.size < MAX_ROUTE_METRIC_ENTRIES) return key;
  return OVERFLOW_ROUTE_METRIC_KEY;
}

function getMetric(route: string) {
  const routeKey = selectRouteMetricKey(route);
  let metric = routeMetrics.get(routeKey);
  if (!metric) {
    metric = {
      requests: 0,
      successes: 0,
      errors: 0,
      cacheHits: 0,
      staleServed: 0,
      inflightJoined: 0,
      backgroundRefreshes: 0,
      lastLatencyMs: null,
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      lastStatus: null,
      lastRequestAt: null,
      lastErrorAt: null,
      inflight: 0,
    };
    routeMetrics.set(routeKey, metric);
  }
  return metric;
}

function completeToken(token: RouteMetricToken, status: number, ok: boolean) {
  if (token.completed) return;
  token.completed = true;

  const metric = getMetric(token.route);
  const latencyMs = normalizeRouteMetricLatencyMs(Date.now() - token.startedAt);
  metric.inflight = Math.max(0, metric.inflight - 1);
  metric.lastLatencyMs = latencyMs;
  metric.maxLatencyMs = Math.max(metric.maxLatencyMs, latencyMs);
  const completedCount = Math.min(metric.successes + metric.errors + 1, MAX_ROUTE_METRIC_COUNT);
  metric.avgLatencyMs = ((metric.avgLatencyMs * (completedCount - 1)) + latencyMs) / completedCount;
  metric.lastStatus = normalizeRouteMetricStatus(status, ok ? 200 : 500);

  if (ok) {
    metric.successes = incrementRouteMetricCount(metric.successes);
  } else {
    metric.errors = incrementRouteMetricCount(metric.errors);
    metric.lastErrorAt = Date.now();
  }
}

export function beginRouteMetric(route: string): RouteMetricToken {
  const routeKey = selectRouteMetricKey(route);
  const metric = getMetric(routeKey);
  metric.requests = incrementRouteMetricCount(metric.requests);
  metric.inflight = incrementRouteMetricCount(metric.inflight);
  metric.lastRequestAt = Date.now();
  return {
    route: routeKey,
    startedAt: Date.now(),
    completed: false,
  };
}

export function markRouteCacheHit(route: string) {
  const metric = getMetric(route);
  metric.cacheHits = incrementRouteMetricCount(metric.cacheHits);
}

export function markRouteStaleServed(route: string) {
  const metric = getMetric(route);
  metric.staleServed = incrementRouteMetricCount(metric.staleServed);
}

export function markRouteInflightJoin(route: string) {
  const metric = getMetric(route);
  metric.inflightJoined = incrementRouteMetricCount(metric.inflightJoined);
}

export function markRouteBackgroundRefresh(route: string) {
  const metric = getMetric(route);
  metric.backgroundRefreshes = incrementRouteMetricCount(metric.backgroundRefreshes);
}

export function finishRouteMetric(token: RouteMetricToken, status = 200) {
  completeToken(token, status, true);
}

export function failRouteMetric(token: RouteMetricToken, status = 500) {
  completeToken(token, status, false);
}

export function getRuntimeMetricsSnapshot() {
  return Object.fromEntries(
    [...routeMetrics.entries()].map(([route, metric]) => [
      route,
      {
        ...metric,
        avgLatencyMs: formatRouteMetricAverageLatencyMs(metric.avgLatencyMs),
      },
    ]),
  );
}

export function getRuntimeProcessSnapshot() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: normalizeRuntimeProcessUptimeSeconds(process.uptime()),
    rssBytes: normalizeRuntimeProcessMetric(memory.rss),
    heapUsedBytes: normalizeRuntimeProcessMetric(memory.heapUsed),
    heapTotalBytes: normalizeRuntimeProcessMetric(memory.heapTotal),
    externalBytes: normalizeRuntimeProcessMetric(memory.external),
  };
}
