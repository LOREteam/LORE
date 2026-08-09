import assert from "node:assert/strict";
import { summarizeEpochCoverage } from "../app/api/health/data-sync/epochCoverage";

const gapped = summarizeEpochCoverage(new Set([1, 2, 4]), 5);
assert.deepEqual(gapped, {
  missingCount: 2,
  latestStoredEpoch: 4,
  highestContiguousEpoch: 2,
  missingLatest: [3, 5],
});

const complete = summarizeEpochCoverage(new Set([1, 2, 3]), 3);
assert.deepEqual(complete, {
  missingCount: 0,
  latestStoredEpoch: 3,
  highestContiguousEpoch: 3,
  missingLatest: [],
});

const hugeEpoch = summarizeEpochCoverage(new Set([1, 2]), Number.MAX_SAFE_INTEGER);
assert.equal(hugeEpoch.missingCount, Number.MAX_SAFE_INTEGER - 2);
assert.equal(hugeEpoch.highestContiguousEpoch, 2);
assert.equal(hugeEpoch.missingLatest.length, 20);
assert.equal(hugeEpoch.missingLatest.at(-1), Number.MAX_SAFE_INTEGER);

assert.throws(
  () => summarizeEpochCoverage(new Set(), Number.MAX_SAFE_INTEGER + 1),
  /non-negative safe integer/,
);

console.log(JSON.stringify({
  ok: true,
  maxSafeEpochBounded: true,
  missingSampleLimit: hugeEpoch.missingLatest.length,
}));
