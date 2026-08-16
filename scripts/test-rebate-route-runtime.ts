import assert from "node:assert/strict";
import {
  REBATE_TIMING_MAX_MS,
  REBATE_UNCHANGED_WATERMARK_REFRESH_MS,
  formatRebateServerTiming,
  formatRebateTimingLogValue,
  formatRebateTimingMs,
  shouldSkipUnchangedRebateRefresh,
  type RebateBuildTimings,
  type RebateCacheWatermark,
} from "../app/api/_lib/rebateRouteRuntime";

type WatermarkDecision = (params: {
  hasWorkingCycle: boolean;
  cachedWatermark: RebateCacheWatermark | null | undefined;
  currentWatermark: string;
  now?: number;
  ttlMs?: number;
}) => boolean;

const TIMINGS: RebateBuildTimings = {
  indexedMs: Number.NaN,
  summaryMs: Number.POSITIVE_INFINITY,
  exactMs: -5,
  recentMs: 1.26,
  totalMs: Number.MAX_VALUE,
  epochCount: Number.MAX_SAFE_INTEGER,
  summaryChunks: Number.MAX_SAFE_INTEGER,
  exactChunks: Number.MAX_SAFE_INTEGER,
};

function assertTimingFormatterPolicy(candidate: (value: number) => string) {
  assert.equal(candidate(Number.NaN), "0.0", "NaN timing must normalize to zero");
  assert.equal(candidate(Number.POSITIVE_INFINITY), "0.0", "infinite timing must normalize to zero");
  assert.equal(candidate(-1), "0.0", "negative timing must normalize to zero");
  assert.equal(candidate(1.26), "1.3", "finite timing must use one decimal place");
  assert.equal(
    candidate(Number.MAX_VALUE),
    `${REBATE_TIMING_MAX_MS}.0`,
    "oversized timing must stay within the publication cap",
  );
}

function watermarkDecision(
  candidate: WatermarkDecision,
  overrides: Partial<Parameters<WatermarkDecision>[0]> = {},
) {
  return candidate({
    hasWorkingCycle: false,
    cachedWatermark: { watermark: "42:9000", refreshedAt: 700_001 },
    currentWatermark: "42:9000",
    now: 1_000_000,
    ttlMs: REBATE_UNCHANGED_WATERMARK_REFRESH_MS,
    ...overrides,
  });
}

function assertWatermarkDecisionPolicy(candidate: WatermarkDecision) {
  assert.equal(watermarkDecision(candidate), true, "an unchanged fresh watermark may skip a redundant rebuild");
  assert.equal(
    watermarkDecision(candidate, { hasWorkingCycle: true }),
    false,
    "an incomplete working scan must always continue",
  );
  assert.equal(watermarkDecision(candidate, { cachedWatermark: null }), false, "missing evidence must rebuild");
  assert.equal(
    watermarkDecision(candidate, {
      cachedWatermark: { watermark: "41:8999", refreshedAt: 700_001 },
    }),
    false,
    "a changed indexed-data watermark must rebuild",
  );
  assert.equal(
    watermarkDecision(candidate, {
      cachedWatermark: { watermark: "42:9000", refreshedAt: 700_000 },
    }),
    false,
    "the exact TTL boundary must rebuild",
  );
  assert.equal(
    watermarkDecision(candidate, {
      cachedWatermark: { watermark: "42:9000", refreshedAt: 1_000_001 },
    }),
    false,
    "a future cache timestamp must fail closed after a clock rollback",
  );
  assert.equal(watermarkDecision(candidate, { now: Number.NaN }), false, "an invalid current time must rebuild");
  assert.equal(
    watermarkDecision(candidate, {
      cachedWatermark: { watermark: "42:9000", refreshedAt: 700_001.5 },
    }),
    false,
    "a fractional cache timestamp must rebuild",
  );
  assert.equal(watermarkDecision(candidate, { ttlMs: 0 }), false, "an invalid TTL must rebuild");
}

function testBoundedTimingPublication() {
  assertTimingFormatterPolicy(formatRebateTimingMs);
  assert.equal(formatRebateTimingLogValue(Number.NaN), 0);
  assert.equal(formatRebateTimingLogValue(Number.MAX_VALUE), REBATE_TIMING_MAX_MS);
  assert.equal(
    formatRebateServerTiming({ cacheStatus: "stale", timings: TIMINGS }),
    `cache;desc="stale", indexed;dur=0.0, summary;dur=0.0, exact;dur=0.0, recent;dur=1.3, total;dur=${REBATE_TIMING_MAX_MS}.0`,
  );
  assert.equal(formatRebateServerTiming({ cacheStatus: "fresh" }), 'cache;desc="fresh"');
}

function testWatermarkRefreshDecision() {
  assertWatermarkDecisionPolicy(shouldSkipUnchangedRebateRefresh);
}

function testTimingMutantIsKilled() {
  assert.throws(
    () => assertTimingFormatterPolicy((value) => Math.max(0, value).toFixed(1)),
    /NaN timing must normalize to zero/,
  );
}

function testWatermarkMutantsAreKilled() {
  const ignoresWatermark: WatermarkDecision = (params) => {
    const cachedWatermark = params.cachedWatermark
      ? { ...params.cachedWatermark, watermark: params.currentWatermark }
      : params.cachedWatermark;
    return shouldSkipUnchangedRebateRefresh({ ...params, cachedWatermark });
  };
  assert.throws(() => assertWatermarkDecisionPolicy(ignoresWatermark), /changed indexed-data watermark must rebuild/);

  const acceptsFutureTimestamp: WatermarkDecision = ({
    hasWorkingCycle,
    cachedWatermark,
    currentWatermark,
    now = Date.now(),
    ttlMs = REBATE_UNCHANGED_WATERMARK_REFRESH_MS,
  }) => Boolean(
    !hasWorkingCycle &&
      cachedWatermark &&
      cachedWatermark.watermark === currentWatermark &&
      now - cachedWatermark.refreshedAt < ttlMs,
  );
  assert.throws(
    () => assertWatermarkDecisionPolicy(acceptsFutureTimestamp),
    /future cache timestamp must fail closed/,
  );
}

function main() {
  testBoundedTimingPublication();
  testWatermarkRefreshDecision();
  testTimingMutantIsKilled();
  testWatermarkMutantsAreKilled();
  console.log("Rebate route runtime behavior tests passed (4 groups, 3 mutants killed).");
}

main();
