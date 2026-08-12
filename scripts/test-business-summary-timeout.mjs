import assert from "node:assert/strict";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const TEST_ENV = "LORE_TEST_SUMMARY_TIMEOUT_MS";

function withTimeoutEnv(value, callback) {
  const previous = process.env[TEST_ENV];
  if (value === undefined) delete process.env[TEST_ENV];
  else process.env[TEST_ENV] = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[TEST_ENV];
    else process.env[TEST_ENV] = previous;
  }
}

export function runSummaryTimeoutTests() {
  withTimeoutEnv(undefined, () => {
    assert.equal(parseSummaryTimeoutEnv(TEST_ENV, 30_000), 30_000);
  });
  withTimeoutEnv("900000", () => {
    assert.equal(parseSummaryTimeoutEnv(TEST_ENV, 30_000), 900_000);
  });
  for (const invalid of ["00", "01", "1e3", "1.5", "-1", "999", "900001", "9007199254740992"]) {
    withTimeoutEnv(invalid, () => {
      assert.throws(() => parseSummaryTimeoutEnv(TEST_ENV, 30_000), /canonical decimal integer|between 1000 and 900000/);
    });
  }
  assert.throws(() => parseSummaryTimeoutEnv(TEST_ENV, 999), /fallback must be between 1000 and 900000/);
  withTimeoutEnv("250", () => {
    assert.equal(parseSummaryTimeoutEnv(TEST_ENV, 200, { min: 100, max: 300 }), 250);
  });
}
