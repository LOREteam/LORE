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

const runtimeMetricsGlobal = globalThis as RuntimeMetricsGlobal;
const routeMetrics =
  runtimeMetricsGlobal.__loreRuntimeMetrics__ ??
  (runtimeMetricsGlobal.__loreRuntimeMetrics__ = new Map<string, RouteMetricState>());

function getMetric(route: string) {
  let metric = routeMetrics.get(route);
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
    routeMetrics.set(route, metric);
  }
  return metric;
}

function completeToken(token: RouteMetricToken, status: number, ok: boolean) {
  if (token.completed) return;
  token.completed = true;

  const metric = getMetric(token.route);
  const latencyMs = Date.now() - token.startedAt;
  metric.inflight = Math.max(0, metric.inflight - 1);
  metric.lastLatencyMs = latencyMs;
  metric.maxLatencyMs = Math.max(metric.maxLatencyMs, latencyMs);
  const completedCount = metric.successes + metric.errors + 1;
  metric.avgLatencyMs = ((metric.avgLatencyMs * (completedCount - 1)) + latencyMs) / completedCount;
  metric.lastStatus = status;

  if (ok) {
    metric.successes += 1;
  } else {
    metric.errors += 1;
    metric.lastErrorAt = Date.now();
  }
}

export function beginRouteMetric(route: string): RouteMetricToken {
  const metric = getMetric(route);
  metric.requests += 1;
  metric.inflight += 1;
  metric.lastRequestAt = Date.now();
  return {
    route,
    startedAt: Date.now(),
    completed: false,
  };
}

export function markRouteCacheHit(route: string) {
  getMetric(route).cacheHits += 1;
}

export function markRouteStaleServed(route: string) {
  getMetric(route).staleServed += 1;
}

export function markRouteInflightJoin(route: string) {
  getMetric(route).inflightJoined += 1;
}

export function markRouteBackgroundRefresh(route: string) {
  getMetric(route).backgroundRefreshes += 1;
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
        avgLatencyMs: Number(metric.avgLatencyMs.toFixed(2)),
      },
    ]),
  );
}
