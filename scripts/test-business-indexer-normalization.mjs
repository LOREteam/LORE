import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseChainPositiveSafeInteger,
  parseChainTileId,
  parseChainTileIds,
  toDisplayNumberWei,
} from "./indexerNormalization.mjs";

export function runIndexerNormalizationTests() {
  const indexerErrorSource = readFileSync("scripts/indexerSafety.ts", "utf8");
  assert.match(indexerErrorSource, /sanitizeSentryPayload\(message\)\.slice\(0, 160\)/);

  assert.equal(parseChainTileId(1n), 1);
  assert.equal(parseChainTileId(25n), 25);
  assert.equal(parseChainTileId(0n), null);
  assert.equal(parseChainTileId(26n), null);
  assert.deepEqual(parseChainTileIds([1n, 25n]), [1, 25]);
  assert.equal(parseChainTileIds([1n, 26n]), null);

  assert.equal(parseChainPositiveSafeInteger(1n), 1);
  assert.equal(parseChainPositiveSafeInteger(0n), null);
  assert.equal(parseChainPositiveSafeInteger(BigInt(Number.MAX_SAFE_INTEGER) + 1n), null);

  assert.equal(toDisplayNumberWei(-1n), 0);
  assert.equal(toDisplayNumberWei(1_500_000_000_000n), 0.000002);
  assert.equal(toDisplayNumberWei((BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000_000_000n), Number.MAX_SAFE_INTEGER);
}
