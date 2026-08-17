import assert from "node:assert/strict";
import {
  parseChainPositiveSafeInteger,
  parseChainTileId,
  parseChainTileIds,
  toDisplayNumberWei,
} from "./indexerNormalization.mjs";
import * as indexerSafetyModule from "./indexerSafety.ts";

const { describeIndexerError } = indexerSafetyModule.default ?? indexerSafetyModule;

export function runIndexerNormalizationTests() {
  const describedSecretError = describeIndexerError(new Error(
    "RPC failed at https://rpc.example/v3/private-key with Bearer top-secret-token",
  ));
  assert.equal(
    describedSecretError,
    "RPC failed at <redacted> with <redacted>",
    "indexer error descriptions must redact network URLs and authorization credentials",
  );
  assert.equal(
    describeIndexerError(new Error("x".repeat(200))).length,
    160,
    "indexer error descriptions must remain bounded after sanitization",
  );
  assert.equal(
    describeIndexerError(null),
    "unknown",
    "indexer error descriptions must fail closed for absent thrown values",
  );

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
