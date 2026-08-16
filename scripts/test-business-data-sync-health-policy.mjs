import assert from "node:assert/strict";
import * as policyModule from "../app/api/health/data-sync/dataSyncHealthPolicy.ts";

const policy = policyModule.default ?? policyModule;
const {
  ageMs,
  bigintToNonNegativeSafeNumber,
  parseChainUintNumber,
  parseStatusBlockString,
  parseStatusCounter,
  parseStatusEpochList,
  parseStatusPositiveInteger,
  parseStatusTimestamp,
  parseStoredBlockNumber,
  parseStoredEpochNumber,
  safeNonNegativeBigintDelta,
  toNum,
} = policy;

export function runDataSyncHealthPolicyTests() {
  assert.equal(parseStoredBlockNumber("0"), 0n);
  assert.equal(parseStoredBlockNumber("001"), 1n);
  assert.equal(parseStoredBlockNumber("900719925474099200000"), 900719925474099200000n);
  for (const value of [null, undefined, "", "-1", "+1", "1.0", "1e3", " 1", "1 "]) {
    assert.equal(parseStoredBlockNumber(value), null);
  }

  assert.equal(parseStoredEpochNumber("1"), 1);
  assert.equal(parseStoredEpochNumber(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of [null, undefined, "", "0", "01", "-1", "+1", "1.0", "1e3", "9007199254740992", "10000000000000000"]) {
    assert.equal(parseStoredEpochNumber(value), null);
  }

  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(parseStatusTimestamp(value), value);
    assert.equal(toNum(value), value);
  }
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1", 1n, null]) {
    assert.equal(parseStatusTimestamp(value), null);
    assert.equal(toNum(value), null);
  }
  assert.equal(ageMs(null, 200), null);
  assert.equal(ageMs(100, 200), 100);
  assert.equal(ageMs(200, 100), 0);

  assert.equal(parseChainUintNumber(0n), 0);
  assert.equal(parseChainUintNumber(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 1, "1", null]) {
    assert.equal(parseChainUintNumber(value), null);
  }

  assert.equal(bigintToNonNegativeSafeNumber(-1n), 0);
  assert.equal(bigintToNonNegativeSafeNumber(0n), 0);
  assert.equal(bigintToNonNegativeSafeNumber(42n), 42);
  assert.equal(bigintToNonNegativeSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n), Number.MAX_SAFE_INTEGER);
  assert.equal(safeNonNegativeBigintDelta(4n, 5n), null);
  assert.equal(safeNonNegativeBigintDelta(5n, 5n), 0);
  assert.equal(safeNonNegativeBigintDelta(10n, 4n), 6);
  assert.equal(
    safeNonNegativeBigintDelta(BigInt(Number.MAX_SAFE_INTEGER) + 100n, 0n),
    Number.MAX_SAFE_INTEGER,
  );

  assert.equal(parseStatusCounter(0), 0);
  assert.equal(parseStatusCounter(1), 1);
  assert.equal(parseStatusPositiveInteger(1), 1);
  for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.equal(parseStatusCounter(value), undefined);
  }
  for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.equal(parseStatusPositiveInteger(value), undefined);
  }

  assert.equal(parseStatusBlockString("001"), "1");
  assert.equal(parseStatusBlockString("1.0"), null);
  assert.equal(parseStatusBlockString(1), null);
  assert.deepEqual(parseStatusEpochList([1, "2", 2, "01", 1.5, 3n, null]), [1, 2]);
  assert.deepEqual(parseStatusEpochList([]), []);
  assert.equal(parseStatusEpochList("1"), undefined);

  const broadEpochMutant = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  assert.equal(broadEpochMutant("01"), 1);
  assert.equal(parseStoredEpochNumber("01"), null);

  const broadTimestampMutant = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  assert.equal(broadTimestampMutant("1"), 1);
  assert.equal(parseStatusTimestamp("1"), null);

  const broadChainMutant = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  assert.equal(broadChainMutant(1), 1);
  assert.equal(parseChainUintNumber(1), null);

  const unsafeDeltaMutant = (upper, lower) => upper < lower ? null : Number(upper - lower);
  assert.equal(
    Number.isSafeInteger(unsafeDeltaMutant(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0n)),
    false,
  );
  assert.equal(
    safeNonNegativeBigintDelta(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0n),
    Number.MAX_SAFE_INTEGER,
  );
}
