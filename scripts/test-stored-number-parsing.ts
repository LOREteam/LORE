import assert from "node:assert/strict";
import {
  parseStoredBlockNumberOrZero,
  parseStoredPositiveIntegerOrZero,
} from "../app/api/_lib/storedNumberParsing";

assert.equal(parseStoredBlockNumberOrZero("42"), 42n);
assert.equal(parseStoredBlockNumberOrZero("0"), 0n);
assert.equal(parseStoredBlockNumberOrZero("0002"), 0n);
assert.equal(parseStoredBlockNumberOrZero("1e3"), 0n);
assert.equal(parseStoredBlockNumberOrZero("-1"), 0n);
assert.equal(parseStoredBlockNumberOrZero(String(10n ** 40n)), 0n);
assert.equal(parseStoredBlockNumberOrZero(null), 0n);

assert.equal(parseStoredPositiveIntegerOrZero("42"), 42);
assert.equal(parseStoredPositiveIntegerOrZero("0002"), 0);
assert.equal(parseStoredPositiveIntegerOrZero("1e3"), 0);
assert.equal(parseStoredPositiveIntegerOrZero("0"), 0);
assert.equal(parseStoredPositiveIntegerOrZero("-1"), 0);
assert.equal(parseStoredPositiveIntegerOrZero("1.5"), 0);
assert.equal(parseStoredPositiveIntegerOrZero(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
assert.equal(parseStoredPositiveIntegerOrZero(String(Number.MAX_SAFE_INTEGER + 1)), 0);
assert.equal(parseStoredPositiveIntegerOrZero((BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()), 0);

console.log("stored number parsing tests passed");
