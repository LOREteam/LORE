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

function emptyStats() {
  return {
    count: 0,
    ok: 0,
    failed: 0,
    statuses: new Map(),
    latencies: [],
    errors: new Map(),
  };
}

function recordStatus(stats, status) {
  stats.statuses.set(status, (stats.statuses.get(status) ?? 0) + 1);
}

function recordError(stats, error) {
  const message = error instanceof Error ? error.message : String(error);
  const key = message.slice(0, 180);
  stats.errors.set(key, (stats.errors.get(key) ?? 0) + 1);
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
        stats.latencies.push(performance.now() - startedAt);
        recordStatus(stats, response.status);
        if (response.ok || response.status === 429) stats.ok = 1;
        else {
          stats.failed = 1;
          recordError(stats, new Error(`status ${response.status}`));
        }
        return null;
      } catch (error) {
        stats.latencies.push(performance.now() - startedAt);
        stats.failed = 1;
        recordError(stats, error);
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
      stats.latencies.push(elapsed);
      globalStats.latencies.push(elapsed);
      recordStatus(stats, response.status);
      recordStatus(globalStats, response.status);
      if (response.ok || response.status === 429) {
        stats.ok += 1;
        globalStats.ok += 1;
      } else {
        stats.failed += 1;
        globalStats.failed += 1;
        recordError(stats, new Error(`status ${response.status}`));
        recordError(globalStats, new Error(`${endpoint.name}: status ${response.status}`));
      }
    } catch (error) {
      const elapsed = performance.now() - startedAt;
      stats.latencies.push(elapsed);
      globalStats.latencies.push(elapsed);
      stats.failed += 1;
      globalStats.failed += 1;
      recordError(stats, error);
      recordError(globalStats, new Error(`${endpoint.name}: ${error instanceof Error ? error.message : String(error)}`));
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
  const p50 = percentile(stats.latencies, 50);
  const p95 = percentile(stats.latencies, 95);
  const p99 = percentile(stats.latencies, 99);
  return `${name.padEnd(17)} count=${String(stats.count).padStart(5)} ok=${String(stats.ok).padStart(5)} fail=${String(stats.failed).padStart(4)} ` +
      `err=${(errorRate * 100).toFixed(2).padStart(6)}% p50=${p50.toFixed(0).padStart(5)}ms ` +
      `p95=${p95.toFixed(0).padStart(5)}ms p99=${p99.toFixed(0).padStart(5)}ms statuses=[${formatLoadStatuses(stats.statuses)}]`;
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
  const p95 = percentile(globalStats.latencies, 95);
  if (errorRate > maxErrorRate) {
    return `load test failed: error rate ${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`;
  }
  if (p95 > maxP95Ms) {
    return `load test failed: p95 ${p95.toFixed(0)}ms > ${maxP95Ms}ms`;
  }
  for (const endpoint of endpoints) {
    const stats = byEndpoint.get(endpoint.name) ?? emptyStats();
    const endpointErrorRate = stats.count > 0 ? stats.failed / stats.count : 1;
    const endpointP95 = percentile(stats.latencies, 95);
    if (endpointErrorRate > maxErrorRate) {
      return `${endpoint.name} load failed: error rate ${(endpointErrorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`;
    }
    if (endpointP95 > maxP95Ms) {
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
