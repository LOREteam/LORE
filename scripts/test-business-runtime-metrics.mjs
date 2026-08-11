import assert from "node:assert/strict";
import * as runtimeMetricsModule from "../app/api/_lib/runtimeMetrics.ts";

const runtimeMetrics = runtimeMetricsModule.default ?? runtimeMetricsModule;

export function runRuntimeMetricsTests() {
  const processSnapshot = runtimeMetrics.getRuntimeProcessSnapshot();
  for (const field of ["uptimeSeconds", "rssBytes", "heapUsedBytes", "heapTotalBytes", "externalBytes"]) {
    assert.ok(Number.isFinite(processSnapshot[field]) && processSnapshot[field] >= 0, `${field} must be bounded runtime evidence`);
  }

  const originalProcessUptime = process.uptime;
  const originalProcessMemoryUsage = process.memoryUsage;
  try {
    process.uptime = () => Number.NaN;
    process.memoryUsage = () => ({
      rss: Number.MAX_SAFE_INTEGER + 1,
      heapUsed: -1,
      heapTotal: 123.5,
      external: 1024,
      arrayBuffers: 0,
    });
    const malformedProcessSnapshot = runtimeMetrics.getRuntimeProcessSnapshot();
    assert.equal(malformedProcessSnapshot.uptimeSeconds, 0, "runtime process uptime must fail closed on malformed values");
    assert.equal(malformedProcessSnapshot.rssBytes, Number.MAX_SAFE_INTEGER, "runtime process memory metrics must saturate oversized values");
    assert.equal(malformedProcessSnapshot.heapUsedBytes, 0, "runtime process memory metrics must reject negative values");
    assert.equal(malformedProcessSnapshot.heapTotalBytes, 0, "runtime process memory metrics must reject fractional values");
    assert.equal(malformedProcessSnapshot.externalBytes, 1024, "runtime process memory metrics must preserve valid values");
  } finally {
    process.uptime = originalProcessUptime;
    process.memoryUsage = originalProcessMemoryUsage;
  }

  const originalDateNow = Date.now;
  try {
    let now = 10_000;
    Date.now = () => now;
    const roundedToken = runtimeMetrics.beginRouteMetric("api/runtime/rounded-latency");
    now += 1.239;
    runtimeMetrics.finishRouteMetric(roundedToken, 201);

    const cappedToken = runtimeMetrics.beginRouteMetric("api/runtime/capped-latency");
    now += 48 * 60 * 60 * 1000;
    runtimeMetrics.finishRouteMetric(cappedToken, 200);

    const backwardsToken = runtimeMetrics.beginRouteMetric("api/runtime/backwards-latency");
    now -= 5;
    runtimeMetrics.failRouteMetric(backwardsToken, 999);
  } finally {
    Date.now = originalDateNow;
  }

  const latencySnapshot = runtimeMetrics.getRuntimeMetricsSnapshot();
  assert.equal(latencySnapshot["api/runtime/rounded-latency"]?.avgLatencyMs, 1.24, "runtime metric averages must publish bounded two-decimal latency");
  assert.equal(latencySnapshot["api/runtime/capped-latency"]?.lastLatencyMs, 24 * 60 * 60 * 1000, "runtime metric latency must cap multi-day durations");
  assert.equal(latencySnapshot["api/runtime/backwards-latency"]?.lastLatencyMs, 0, "runtime metric latency must reject clock rollback");
  assert.equal(latencySnapshot["api/runtime/backwards-latency"]?.lastStatus, 500, "failed runtime metrics must normalize malformed statuses to a safe failure status");

  const unsafeRouteMetricToken = runtimeMetrics.beginRouteMetric(
    `api/runtime/probe https://rpc.example.test/private privateKey=${"a".repeat(64)}`,
  );
  runtimeMetrics.finishRouteMetric(unsafeRouteMetricToken, Number.NaN);
  const unsafeRouteMetricKeys = Object.keys(runtimeMetrics.getRuntimeMetricsSnapshot())
    .filter((key) => key.includes("api/runtime/probe"));
  assert.equal(unsafeRouteMetricKeys.length, 1, "runtime metrics must keep a normalized route label for probe routes");
  assert.doesNotMatch(unsafeRouteMetricKeys[0], /rpc\.example|private|a{64}|https?:/i, "runtime metrics route labels must not publish provider URLs or secret-looking material");
  assert.ok(unsafeRouteMetricKeys[0].length <= 120, "runtime metrics route labels must be length-bounded");
  assert.equal(runtimeMetrics.getRuntimeMetricsSnapshot()[unsafeRouteMetricKeys[0]]?.lastStatus, 200, "successful runtime metrics must normalize malformed statuses to a safe success status");

  for (let index = 0; index < 140; index += 1) {
    const token = runtimeMetrics.beginRouteMetric(`api/runtime/overflow-${index}`);
    runtimeMetrics.finishRouteMetric(token, 200);
  }
  assert.ok(runtimeMetrics.getRuntimeMetricsSnapshot().__overflow__, "runtime metrics must cap unbounded route labels through a shared overflow entry");
}
