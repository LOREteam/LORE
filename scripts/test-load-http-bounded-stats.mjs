import assert from "node:assert/strict";
import {
  createLoadStats,
  firstLoadThresholdFailure,
  LOAD_ERROR_SAMPLE_CAPACITY,
  LOAD_LATENCY_RESERVOIR_CAPACITY,
  hasExactP95ThresholdFailure,
  recordLoadError,
  recordLoadLatency,
  sanitizeLoadErrorSample,
  summarizeLoadLatencies,
} from "./load-http.mjs";

const shortRun = createLoadStats();
for (const value of [10, 20, 30]) recordLoadLatency(shortRun, value);
assert.deepEqual(summarizeLoadLatencies(shortRun), {
  samples: 3,
  sampled: 3,
  p50: 20,
  p95: 30,
  p99: 30,
  max: 30,
});

const longRun = createLoadStats();
const longRunSamples = LOAD_LATENCY_RESERVOIR_CAPACITY * 3 + 17;
for (let value = 0; value < longRunSamples; value += 1) recordLoadLatency(longRun, value);
const longSummary = summarizeLoadLatencies(longRun);
assert.equal(longSummary.samples, longRunSamples);
assert.equal(longSummary.sampled, LOAD_LATENCY_RESERVOIR_CAPACITY);
assert.equal(longSummary.max, longRunSamples - 1);
assert.ok(longSummary.p50 >= 0 && longSummary.p50 <= longSummary.max);
assert.ok(longSummary.p95 >= longSummary.p50 && longSummary.p95 <= longSummary.max);
assert.ok(longSummary.p99 >= longSummary.p95 && longSummary.p99 <= longSummary.max);
const identicalLongRun = createLoadStats();
for (let value = 0; value < longRunSamples; value += 1) recordLoadLatency(identicalLongRun, value);
assert.deepEqual(identicalLongRun.latencies, longRun.latencies);
assert.ok(Math.abs(longSummary.p95 - Math.floor(longRunSamples * 0.95)) <= Math.ceil(longRunSamples * 0.05));

const p95TailBoundary = createLoadStats({ p95ThresholdMs: 100 });
for (let index = 0; index < 19; index += 1) recordLoadLatency(p95TailBoundary, 100);
recordLoadLatency(p95TailBoundary, 101);
assert.equal(hasExactP95ThresholdFailure(p95TailBoundary, 100), false);
recordLoadLatency(p95TailBoundary, 101);
assert.equal(hasExactP95ThresholdFailure(p95TailBoundary, 100), true);
assert.equal(
  firstLoadThresholdFailure({
    globalStats: { ...p95TailBoundary, count: 21, failed: 0 },
    byEndpoint: new Map(),
    maxErrorRate: 0.01,
    maxP95Ms: 100,
    endpoints: [],
  }),
  "load failed: exact p95 tail 2/21 samples > 100ms (allowed 1)",
);

const errors = createLoadStats();
for (let index = 0; index < LOAD_ERROR_SAMPLE_CAPACITY + 5; index += 1) {
  recordLoadError(errors, new Error(`distinct-${index}`));
}
recordLoadError(errors, new Error("distinct-0"));
assert.equal(errors.errorCount, LOAD_ERROR_SAMPLE_CAPACITY + 6);
assert.equal(errors.errors.size, LOAD_ERROR_SAMPLE_CAPACITY);
assert.equal(errors.errors.get("distinct-0"), 2);
assert.equal(errors.uncataloguedErrorCount, 5);

const sensitiveError = sanitizeLoadErrorSample(
  "request https://operator:wallet-secret@rpc.example/path?token=private-token failed: apiKey=other-secret",
);
assert.equal(sensitiveError.includes("wallet-secret"), false);
assert.equal(sensitiveError.includes("private-token"), false);
assert.equal(sensitiveError.includes("other-secret"), false);
assert.match(sensitiveError, /<redacted/i);
assert.match(sanitizeLoadErrorSample(`plain failure ${"x".repeat(400)}`), /<truncated>$/);

console.log(JSON.stringify({
  status: "pass",
  exactShortRun: true,
  latencyReservoirCapacity: LOAD_LATENCY_RESERVOIR_CAPACITY,
  errorSampleCapacity: LOAD_ERROR_SAMPLE_CAPACITY,
  longRunSamples,
  exactP95TailGate: true,
  redactedErrorSamples: true,
}));
