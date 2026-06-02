import { performance } from "node:perf_hooks";

const BASE_URL = process.env.LOAD_BASE_URL || process.env.SMOKE_BASE_URL || "http://localhost:3001";
const DURATION_MS = Number(process.env.LOAD_DURATION_MS || 60_000);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 500);
const TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MS || 10_000);
const MAX_ERROR_RATE = Number(process.env.LOAD_MAX_ERROR_RATE || 0.01);
const MAX_P95_MS = Number(process.env.LOAD_MAX_P95_MS || 1_500);
const CLIENT_IPS = Math.max(1, Number(process.env.LOAD_CLIENT_IPS || CONCURRENCY));
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000001";

const endpoints = [
  { name: "home", path: "/", weight: 8 },
  { name: "live-state", path: "/api/live-state", weight: 34 },
  { name: "epochs", path: "/api/epochs?epochs=1,2,3", weight: 12 },
  { name: "jackpots", path: "/api/jackpots", weight: 9 },
  { name: "leaderboards", path: "/api/leaderboards", weight: 8 },
  { name: "recent-wins", path: "/api/recent-wins", weight: 8 },
  { name: "chat-messages", path: "/api/chat/messages", weight: 9 },
  { name: "deposits", path: `/api/deposits?user=${ZERO_ADDRESS}`, weight: 6 },
  { name: "deposits-rewards", path: `/api/deposits?user=${ZERO_ADDRESS}&includeRewards=1`, weight: 3 },
  { name: "rebates", path: `/api/rebates?user=${ZERO_ADDRESS}`, weight: 3 },
];

const weightedEndpoints = endpoints.flatMap((endpoint) =>
  Array.from({ length: endpoint.weight }, () => endpoint),
);

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
    return await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
        "cf-connecting-ip": clientIp,
        "x-real-ip": clientIp,
        "x-forwarded-for": clientIp,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function warmUp() {
  await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const response = await fetchWithTimeout(endpoint.path);
        await response.arrayBuffer();
      } catch {
        // The measured run below reports real failures.
      }
    }),
  );
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
      await response.arrayBuffer();
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

function formatStatuses(statuses) {
  return [...statuses.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");
}

function printStats(name, stats) {
  const errorRate = stats.count > 0 ? stats.failed / stats.count : 0;
  const p50 = percentile(stats.latencies, 50);
  const p95 = percentile(stats.latencies, 95);
  const p99 = percentile(stats.latencies, 99);
  console.log(
    `${name.padEnd(17)} count=${String(stats.count).padStart(5)} ok=${String(stats.ok).padStart(5)} fail=${String(stats.failed).padStart(4)} ` +
      `err=${(errorRate * 100).toFixed(2).padStart(6)}% p50=${p50.toFixed(0).padStart(5)}ms ` +
      `p95=${p95.toFixed(0).padStart(5)}ms p99=${p99.toFixed(0).padStart(5)}ms statuses=[${formatStatuses(stats.statuses)}]`,
  );
}

async function main() {
  if (!Number.isFinite(CONCURRENCY) || CONCURRENCY <= 0) {
    throw new Error("LOAD_CONCURRENCY must be a positive number");
  }
  if (!Number.isFinite(DURATION_MS) || DURATION_MS <= 0) {
    throw new Error("LOAD_DURATION_MS must be a positive number");
  }

  console.log(`Load base URL: ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}; client IPs: ${CLIENT_IPS}; duration: ${DURATION_MS}ms; timeout: ${TIMEOUT_MS}ms`);
  await warmUp();

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
  for (const endpoint of endpoints) {
    printStats(endpoint.name, byEndpoint.get(endpoint.name) ?? emptyStats());
  }

  if (globalStats.errors.size > 0) {
    console.log("\nTop errors:");
    for (const [message, count] of [...globalStats.errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${count}x ${message}`);
    }
  }

  const errorRate = globalStats.count > 0 ? globalStats.failed / globalStats.count : 1;
  const p95 = percentile(globalStats.latencies, 95);
  if (errorRate > MAX_ERROR_RATE) {
    throw new Error(`load test failed: error rate ${(errorRate * 100).toFixed(2)}% > ${(MAX_ERROR_RATE * 100).toFixed(2)}%`);
  }
  if (p95 > MAX_P95_MS) {
    throw new Error(`load test failed: p95 ${p95.toFixed(0)}ms > ${MAX_P95_MS}ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
