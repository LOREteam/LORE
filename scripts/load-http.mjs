import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  parseNonNegativeNumberInRangeEnv,
  parsePositiveIntegerEnv,
  parsePositiveIntegerInRangeEnv,
} from "./env-parsing.mjs";
import { redactProofText } from "./redact-proof-output.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000001";
const MAX_LOAD_ERROR_CHARS = 500;
const HTTP_STATUS_RE = /^[1-5]\d{2}$/;
export const LOAD_LATENCY_RESERVOIR_CAPACITY = 4_096;
export const LOAD_ERROR_SAMPLE_CAPACITY = 32;
const LOAD_RESERVOIR_INITIAL_STATE = 0x6d2b79f5;

export const LOAD_HTTP_ENDPOINTS = Object.freeze([
  { name: "home", path: "/", weight: 8 },
  { name: "live-state", path: "/api/live-state", weight: 34 },
  { name: "epochs", path: "/api/epochs?epochs=1,2,3", weight: 12 },
  { name: "jackpots", path: "/api/jackpots", weight: 9 },
  { name: "global-stats", path: "/api/global-stats", weight: 6 },
  { name: "leaderboards", path: "/api/leaderboards", weight: 8 },
  { name: "recent-wins", path: "/api/recent-wins", weight: 8 },
  { name: "chat-messages", path: "/api/chat/messages", weight: 9 },
  { name: "deposits", path: `/api/deposits?user=${ZERO_ADDRESS}`, weight: 6 },
  { name: "deposits-rewards", path: `/api/deposits?user=${ZERO_ADDRESS}&includeRewards=1`, weight: 3 },
  { name: "rebates", path: `/api/rebates?user=${ZERO_ADDRESS}`, weight: 3 },
].map((endpoint) => Object.freeze(endpoint)));

export function resolveLoadHttpConfig(env = process.env) {
  const concurrency = parsePositiveIntegerEnv(env.LOAD_CONCURRENCY, 50);
  return Object.freeze({
    baseUrl: env.LOAD_BASE_URL || env.SMOKE_BASE_URL || "http://localhost:3001",
    allowLocal: env.LOAD_ALLOW_LOCAL === "1",
    durationMs: parsePositiveIntegerEnv(env.LOAD_DURATION_MS, 60_000),
    concurrency,
    timeoutMs: parsePositiveIntegerEnv(env.LOAD_TIMEOUT_MS, 10_000),
    maxErrorRate: parseNonNegativeNumberInRangeEnv(env.LOAD_MAX_ERROR_RATE, 0.01, 0, 1),
    maxP95Ms: parsePositiveIntegerEnv(env.LOAD_MAX_P95_MS, 1_500),
    clientIps: parsePositiveIntegerInRangeEnv(env.LOAD_CLIENT_IPS, concurrency, 1, concurrency),
  });
}

const LOAD_CONFIG = resolveLoadHttpConfig();
const {
  baseUrl: BASE_URL,
  allowLocal: ALLOW_LOCAL,
  durationMs: DURATION_MS,
  concurrency: CONCURRENCY,
  timeoutMs: TIMEOUT_MS,
  maxErrorRate: MAX_ERROR_RATE,
  maxP95Ms: MAX_P95_MS,
  clientIps: CLIENT_IPS,
} = LOAD_CONFIG;

const weightedEndpoints = LOAD_HTTP_ENDPOINTS.flatMap((endpoint) =>
  Array.from({ length: endpoint.weight }, () => endpoint),
);

export function describeLoadError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_LOAD_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_LOAD_ERROR_CHARS - 15)}...<truncated>`;
}

export function isNonLocalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^0\./.test(host) ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^192\.0\.2\./.test(host) ||
        /^198\.(1[89])\./.test(host) ||
        /^198\.51\.100\./.test(host) ||
        /^203\.0\.113\./.test(host) ||
        /^::ffff:/i.test(host) ||
        /^f[cd][0-9a-f]*:/i.test(host) ||
        /^fe[89ab][0-9a-f]*:/i.test(host) ||
        /^2001:db8:/i.test(host)
      );
  } catch {
    return false;
  }
}
function percentile(values, pct) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function normalizeP95ThresholdMs(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function createLoadStats({ p95ThresholdMs = MAX_P95_MS } = {}) {
  const exactP95ThresholdMs = normalizeP95ThresholdMs(p95ThresholdMs);
  return {
    count: 0,
    ok: 0,
    failed: 0,
    statuses: new Map(),
    latencies: [],
    latencySampleCount: 0,
    latencyMaxMs: 0,
    latencyReservoirState: LOAD_RESERVOIR_INITIAL_STATE,
    exactP95ThresholdMs,
    exactP95ThresholdExceededCount: 0,
    errors: new Map(),
    errorCount: 0,
    uncataloguedErrorCount: 0,
  };
}

function recordStatus(stats, status) {
  stats.statuses.set(status, (stats.statuses.get(status) ?? 0) + 1);
}

function nextReservoirRandom(stats) {
  let state = Number.isSafeInteger(stats.latencyReservoirState)
    ? stats.latencyReservoirState >>> 0
    : LOAD_RESERVOIR_INITIAL_STATE;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  stats.latencyReservoirState = state;
  return state;
}

export function recordLoadLatency(stats, value) {
  if (!Number.isFinite(value) || value < 0) return;
  stats.latencySampleCount = (Number.isSafeInteger(stats.latencySampleCount) ? stats.latencySampleCount : 0) + 1;
  stats.latencyMaxMs = Math.max(Number.isFinite(stats.latencyMaxMs) ? stats.latencyMaxMs : 0, value);
  if (normalizeP95ThresholdMs(stats.exactP95ThresholdMs) !== null && value > stats.exactP95ThresholdMs) {
    stats.exactP95ThresholdExceededCount = (
      Number.isSafeInteger(stats.exactP95ThresholdExceededCount) ? stats.exactP95ThresholdExceededCount : 0
    ) + 1;
  }
  if (stats.latencies.length < LOAD_LATENCY_RESERVOIR_CAPACITY) {
    stats.latencies.push(value);
    return;
  }
  const reservoirIndex = nextReservoirRandom(stats) % stats.latencySampleCount;
  if (reservoirIndex < LOAD_LATENCY_RESERVOIR_CAPACITY) stats.latencies[reservoirIndex] = value;
}

export function sanitizeLoadErrorSample(error) {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactProofText(message)
    .replace(/\b(?:https?|wss?):\/\/[^\s/@]+:[^\s/@]+@/gi, "<redacted-url-credentials>@")
    .replace(/([?&](?:access[_-]?token|api[_-]?key|authorization|key|password|secret|token)=)[^&#\s]+/gi, "$1<redacted>")
    .replace(/\b((?:access[_-]?token|api[_-]?key|authorization|key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, "$1<redacted>")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= 180) return redacted || "unknown error";
  return `${redacted.slice(0, 165)}...<truncated>`;
}

export function recordLoadError(stats, error) {
  const key = sanitizeLoadErrorSample(error);
  stats.errorCount = (Number.isSafeInteger(stats.errorCount) ? stats.errorCount : 0) + 1;
  if (stats.errors.has(key)) {
    stats.errors.set(key, (stats.errors.get(key) ?? 0) + 1);
    return;
  }
  if (stats.errors.size < LOAD_ERROR_SAMPLE_CAPACITY) {
    stats.errors.set(key, 1);
    return;
  }
  stats.uncataloguedErrorCount = (
    Number.isSafeInteger(stats.uncataloguedErrorCount) ? stats.uncataloguedErrorCount : 0
  ) + 1;
}

function emptyStats() {
  return createLoadStats();
}

export function summarizeLoadLatencies(stats) {
  const latencies = Array.isArray(stats?.latencies) ? stats.latencies : [];
  const sampled = latencies.length;
  const total = Number.isSafeInteger(stats?.latencySampleCount) && stats.latencySampleCount >= sampled
    ? stats.latencySampleCount
    : sampled;
  const sampledMax = latencies.length === 0 ? 0 : Math.max(...latencies);
  return {
    samples: total,
    sampled,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: Number.isFinite(stats?.latencyMaxMs) ? Math.max(stats.latencyMaxMs, sampledMax) : sampledMax,
  };
}

export function hasExactP95ThresholdFailure(stats, thresholdMs) {
  const normalizedThreshold = normalizeP95ThresholdMs(thresholdMs);
  const samples = Number.isSafeInteger(stats?.latencySampleCount) && stats.latencySampleCount >= 0
    ? stats.latencySampleCount
    : null;
  if (
    normalizedThreshold === null
    || samples === null
    || normalizeP95ThresholdMs(stats?.exactP95ThresholdMs) !== normalizedThreshold
    || !Number.isSafeInteger(stats?.exactP95ThresholdExceededCount)
    || stats.exactP95ThresholdExceededCount < 0
  ) {
    return null;
  }
  return stats.exactP95ThresholdExceededCount > Math.floor(samples / 20);
}

function exactP95ThresholdFailureMessage(prefix, stats, thresholdMs) {
  const samples = stats.latencySampleCount;
  const exceeded = stats.exactP95ThresholdExceededCount;
  return `${prefix}load failed: exact p95 tail ${exceeded}/${samples} samples > ${thresholdMs}ms ` +
    `(allowed ${Math.floor(samples / 20)})`;
}

function getClientIp(workerId) {
  const clientId = workerId % CLIENT_IPS;
  return `198.18.${Math.floor(clientId / 250)}.${(clientId % 250) + 1}`;
}

async function fetchWithTimeout(path, workerId = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const clientIp = getClientIp(workerId);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
        "cf-connecting-ip": clientIp,
        "x-real-ip": clientIp,
        "x-forwarded-for": clientIp,
      },
    });
    await response.arrayBuffer();
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function warmUp() {
  const coldStats = new Map();
  const results = await Promise.all(
    LOAD_HTTP_ENDPOINTS.map(async (endpoint) => {
      const stats = emptyStats();
      coldStats.set(endpoint.name, stats);
      const startedAt = performance.now();
      stats.count = 1;
      try {
        const response = await fetchWithTimeout(endpoint.path);
        recordLoadLatency(stats, performance.now() - startedAt);
        recordStatus(stats, response.status);
        if (response.ok || response.status === 429) stats.ok = 1;
        else {
          stats.failed = 1;
          recordLoadError(stats, new Error(`status ${response.status}`));
        }
        return null;
      } catch (error) {
        recordLoadLatency(stats, performance.now() - startedAt);
        stats.failed = 1;
        recordLoadError(stats, error);
        return endpoint.name;
      }
    }),
  );
  const failed = results.filter((name) => name !== null);
  assertReachableLoadWarmup(failed);
  if (failed.length > 0) {
    console.warn(`Warm-up skipped failed endpoints: ${failed.join(", ")}`);
  }
  return coldStats;
}

async function runWorker(workerId, deadline, globalStats, byEndpoint) {
  let index = workerId % weightedEndpoints.length;
  while (performance.now() < deadline) {
    const endpoint = weightedEndpoints[index % weightedEndpoints.length];
    index += CONCURRENCY;
    const stats = byEndpoint.get(endpoint.name) ?? emptyStats();
    byEndpoint.set(endpoint.name, stats);

    const startedAt = performance.now();
    stats.count += 1;
    globalStats.count += 1;
    try {
      const response = await fetchWithTimeout(endpoint.path, workerId);
      const elapsed = performance.now() - startedAt;
      recordLoadLatency(stats, elapsed);
      recordLoadLatency(globalStats, elapsed);
      recordStatus(stats, response.status);
      recordStatus(globalStats, response.status);
      if (response.ok || response.status === 429) {
        stats.ok += 1;
        globalStats.ok += 1;
      } else {
        stats.failed += 1;
        globalStats.failed += 1;
        recordLoadError(stats, new Error(`status ${response.status}`));
        recordLoadError(globalStats, new Error(`${endpoint.name}: status ${response.status}`));
      }
    } catch (error) {
      const elapsed = performance.now() - startedAt;
      recordLoadLatency(stats, elapsed);
      recordLoadLatency(globalStats, elapsed);
      stats.failed += 1;
      globalStats.failed += 1;
      recordLoadError(stats, error);
      recordLoadError(globalStats, new Error(`${endpoint.name}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

export function formatLoadStatuses(statuses) {
  function normalizeStatus(value) {
    const text = String(value ?? "").trim();
    if (!HTTP_STATUS_RE.test(text)) return null;
    const status = Number(text);
    return Number.isSafeInteger(status) ? status : null;
  }

  return [...statuses.entries()]
    .sort((a, b) => {
      const left = normalizeStatus(a[0]);
      const right = normalizeStatus(b[0]);
      if (left !== null && right !== null) return left - right;
      if (left !== null) return -1;
      if (right !== null) return 1;
      return 0;
    })
    .map(([status, count]) => `${normalizeStatus(status) ?? "invalid-status"}:${count}`)
    .join(" ");
}

export function formatLoadStatsLine(name, stats) {
  const errorRate = stats.count > 0 ? stats.failed / stats.count : 0;
  const latency = summarizeLoadLatencies(stats);
  const { p50, p95, p99 } = latency;
  return `${name.padEnd(17)} count=${String(stats.count).padStart(5)} ok=${String(stats.ok).padStart(5)} fail=${String(stats.failed).padStart(4)} ` +
      `err=${(errorRate * 100).toFixed(2).padStart(6)}% p50=${p50.toFixed(0).padStart(5)}ms ` +
      `p95=${p95.toFixed(0).padStart(5)}ms p99=${p99.toFixed(0).padStart(5)}ms ` +
      `quantiles=sampled-approx samples=${latency.sampled}/${latency.samples} statuses=[${formatLoadStatuses(stats.statuses)}]`;
}

function printStats(name, stats) {
  console.log(formatLoadStatsLine(name, stats));
}

export function assertReachableLoadWarmup(
  failedNames,
  endpointCount = LOAD_HTTP_ENDPOINTS.length,
  baseUrl = BASE_URL,
) {
  if (failedNames.length === endpointCount) {
    throw new Error(`load warm-up could not reach ${baseUrl}; all endpoints failed`);
  }
}

export function listColdLoadFailures(coldStats, endpoints = LOAD_HTTP_ENDPOINTS) {
  return endpoints.filter((endpoint) => (coldStats.get(endpoint.name)?.failed ?? 1) > 0);
}

export function firstLoadThresholdFailure({
  globalStats,
  byEndpoint,
  maxErrorRate,
  maxP95Ms,
  endpoints = LOAD_HTTP_ENDPOINTS,
}) {
  const errorRate = globalStats.count > 0 ? globalStats.failed / globalStats.count : 1;
  const exactGlobalP95Failure = hasExactP95ThresholdFailure(globalStats, maxP95Ms);
  const p95 = summarizeLoadLatencies(globalStats).p95;
  if (errorRate > maxErrorRate) {
    return `load test failed: error rate ${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`;
  }
  if (exactGlobalP95Failure === true) {
    return exactP95ThresholdFailureMessage("", globalStats, maxP95Ms);
  }
  if (exactGlobalP95Failure === null && p95 > maxP95Ms) {
    return `load test failed: p95 ${p95.toFixed(0)}ms > ${maxP95Ms}ms`;
  }
  for (const endpoint of endpoints) {
    const stats = byEndpoint.get(endpoint.name) ?? emptyStats();
    const endpointErrorRate = stats.count > 0 ? stats.failed / stats.count : 1;
    const exactEndpointP95Failure = hasExactP95ThresholdFailure(stats, maxP95Ms);
    const endpointP95 = summarizeLoadLatencies(stats).p95;
    if (endpointErrorRate > maxErrorRate) {
      return `${endpoint.name} load failed: error rate ${(endpointErrorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`;
    }
    if (exactEndpointP95Failure === true) {
      return exactP95ThresholdFailureMessage(`${endpoint.name} `, stats, maxP95Ms);
    }
    if (exactEndpointP95Failure === null && endpointP95 > maxP95Ms) {
      return `${endpoint.name} load failed: p95 ${endpointP95.toFixed(0)}ms > ${maxP95Ms}ms`;
    }
  }
  return null;
}

export async function main() {
  if (!ALLOW_LOCAL && !isNonLocalHttpsOrigin(BASE_URL)) {
    throw new Error("LOAD_BASE_URL must be a public HTTPS origin for launch load evidence; localhost/private/reserved/example/test origins are launch-proof invalid. Set LOAD_ALLOW_LOCAL=1 only for local smoke checks");
  }

  if (!Number.isFinite(CONCURRENCY) || CONCURRENCY <= 0) {
    throw new Error("LOAD_CONCURRENCY must be a positive number");
  }
  if (!Number.isFinite(DURATION_MS) || DURATION_MS <= 0) {
    throw new Error("LOAD_DURATION_MS must be a positive number");
  }

  console.log(`Load base URL: ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}; client IPs: ${CLIENT_IPS}; duration: ${DURATION_MS}ms; timeout: ${TIMEOUT_MS}ms`);
  const coldStats = await warmUp();
  console.log("\nCold first requests:");
  for (const endpoint of LOAD_HTTP_ENDPOINTS) {
    printStats(`COLD ${endpoint.name}`, coldStats.get(endpoint.name) ?? emptyStats());
  }
  const coldFailures = listColdLoadFailures(coldStats);
  if (coldFailures.length > 0) {
    throw new Error(`cold load checks failed: ${coldFailures.map((endpoint) => endpoint.name).join(", ")}`);
  }

  const globalStats = emptyStats();
  const byEndpoint = new Map();
  const startedAt = performance.now();
  const deadline = startedAt + DURATION_MS;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, workerId) =>
      runWorker(workerId, deadline, globalStats, byEndpoint),
    ),
  );
  const elapsedSec = (performance.now() - startedAt) / 1000;

  console.log(`\nRequests/sec: ${(globalStats.count / elapsedSec).toFixed(1)}`);
  printStats("TOTAL", globalStats);
  for (const endpoint of LOAD_HTTP_ENDPOINTS) {
    printStats(endpoint.name, byEndpoint.get(endpoint.name) ?? emptyStats());
  }

  if (globalStats.errors.size > 0) {
    console.log("\nTop errors:");
    for (const [message, count] of [...globalStats.errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${count}x ${message}`);
    }
    if (globalStats.uncataloguedErrorCount > 0) {
      console.log(`  ${globalStats.uncataloguedErrorCount}x uncatalogued error events`);
    }
  }

  const thresholdFailure = firstLoadThresholdFailure({
    globalStats,
    byEndpoint,
    maxErrorRate: MAX_ERROR_RATE,
    maxP95Ms: MAX_P95_MS,
  });
  if (thresholdFailure) throw new Error(thresholdFailure);
}

export async function runLoadHttpCli({ mainFn = main, processLike = process, logger = console } = {}) {
  try {
    await mainFn();
    return { ok: true };
  } catch (error) {
    logger.error(describeLoadError(error));
    processLike.exitCode = 1;
    return { ok: false };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runLoadHttpCli();
}
