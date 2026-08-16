import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as readModelSafetyModule from "../app/api/_lib/readModelSafety.ts";

const readModelSafety = readModelSafetyModule.default ?? readModelSafetyModule;
const {
  computeReadModelExpiresAt,
  isFreshReadModelCache,
  parseReadModelEpochNumber,
  parseReadModelTileId,
} = readModelSafety;

function assertReadModelExpiryPolicy(candidate) {
  assert.equal(candidate(10, 20), 30, "a valid TTL must produce an exact expiry");
  assert.equal(
    candidate(1, Number.MAX_SAFE_INTEGER - 1),
    Number.MAX_SAFE_INTEGER,
    "an expiry at the safe-integer boundary must remain valid",
  );
  assert.equal(
    candidate(2, Number.MAX_SAFE_INTEGER - 1),
    Number.MAX_SAFE_INTEGER,
    "an overflowing TTL must clamp without wrapping or losing freshness",
  );
  for (const [ttlMs, now] of [
    [0, 20],
    [-1, 20],
    [1.5, 20],
    [Number.NaN, 20],
    [1, -1],
    [1, Number.NaN],
    [1, Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.equal(candidate(ttlMs, now), 0, "malformed cache timing must fail closed");
  }
}

function assertReadModelFreshnessPolicy(candidate) {
  assert.equal(candidate({ expiresAt: 101 }, 100), true, "unexpired cache evidence must be fresh");
  assert.equal(candidate({ expiresAt: 100 }, 100), false, "expiry must be exclusive at the boundary");
  assert.equal(candidate({ expiresAt: 99 }, 100), false, "expired cache evidence must be stale");
  assert.equal(candidate({ expiresAt: Number.NaN }, 100), false, "malformed expiry must be stale");
  assert.equal(candidate({ expiresAt: 101 }, Number.NaN), false, "malformed caller time must be stale");
  assert.equal(candidate(null, 100), false, "a missing cache entry must be stale");
}

function assertReadModelEpochPolicy(candidate) {
  for (const [value, expected] of [
    [1, 1],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [1n, 1],
    [BigInt(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ["1", 1],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(candidate(value), expected, "canonical epoch evidence must narrow exactly");
  }
  for (const value of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    0n,
    -1n,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    "",
    "0",
    "01",
    "+1",
    "1e3",
    " 1",
    "1 ",
    "1.0",
    null,
    undefined,
  ]) {
    assert.equal(candidate(value), null, "non-canonical or unsafe epoch evidence must be rejected");
  }
}

function assertReadModelTilePolicy(candidate) {
  for (const [value, expected] of [[1, 1], [25, 25], [1n, 1], [25n, 25]]) {
    assert.equal(candidate(value), expected, "a protocol tile must narrow exactly");
  }
  for (const value of [0, -1, 1.5, 26, Number.NaN, Number.POSITIVE_INFINITY, 0n, -1n, 26n]) {
    assert.equal(candidate(value), null, "out-of-domain tile evidence must be rejected");
  }
}

export function runApiRecoveryStorageTests() {
  assertReadModelExpiryPolicy(computeReadModelExpiresAt);
  assertReadModelFreshnessPolicy(isFreshReadModelCache);
  assertReadModelEpochPolicy(parseReadModelEpochNumber);
  assertReadModelTilePolicy(parseReadModelTileId);

  assert.throws(
    () => assertReadModelExpiryPolicy((ttlMs, now) => now + ttlMs),
    /overflowing TTL/,
    "a raw-addition expiry mutant must be killed",
  );
  assert.throws(
    () => assertReadModelFreshnessPolicy((entry, now) => Boolean(entry && entry.expiresAt >= now)),
    /exclusive at the boundary/,
    "an inclusive-expiry freshness mutant must be killed",
  );
  assert.throws(
    () => assertReadModelEpochPolicy((value) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }),
    /unsafe epoch evidence/,
    "a broad Number coercion epoch mutant must be killed",
  );
  assert.throws(
    () => assertReadModelTilePolicy((value) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }),
    /out-of-domain tile evidence/,
    "a missing tile upper-bound mutant must be killed",
  );

  const persistenceProbe = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/test-api-storage-persistence-behavior.ts"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(
    persistenceProbe.status,
    0,
    persistenceProbe.stderr || persistenceProbe.stdout || persistenceProbe.error?.message,
  );
  const persistenceSummary = JSON.parse(persistenceProbe.stdout.trim());
  assert.deepEqual(persistenceSummary, {
    status: "pass",
    activeSqliteArtifactsPreserved: true,
    strictPersistence: true,
    scopedPagination: true,
    boundedBridgeRead: true,
    storageLogsRedacted: true,
    mutantsKilled: 5,
    fakeRpcCallsHandled: true,
    networkCalls: 0,
  });

  const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");
  assert.match(
    depositsRouteSource,
    /function parseStoredBlockNumber/,
    "deposits API must tolerate corrupted stored block numbers",
  );
  assert.match(
    depositsRouteSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "deposits API totalAmountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /totalAmountNum:\s*(?:Number\.)?parseFloat\(formatUnits\(|prev\.totalAmountNum = Number\.parseFloat\(prev\.totalAmount\)/,
    "deposits API must not derive totalAmountNum through parseFloat(formatUnits()) or parsed decimal strings",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "deposits API totalAmountNum compatibility fields must not parse formatted decimal strings",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /BigInt\([^)]*blockNumber\s*\|\|\s*"0"\)/,
    "deposits API must not call BigInt directly on stored blockNumber strings",
  );
  assert.match(
    depositsRouteSource,
    /function parseStoredEpochNumber/,
    "deposits API must parse stored epochs safely for sorting and inline rewards",
  );
  assert.match(
    depositsRouteSource,
    /user\s*=\s*getAddress\(userParam \?\? ""\)\.toLowerCase\(\)/,
    "deposits API must normalize query user addresses with the EVM address parser",
  );
  assert.match(
    depositsRouteSource,
    /addressToTopic[\s\S]*getAddress\(address\)/,
    "deposits chain recovery must normalize user addresses before building indexed log topics",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "deposits API must not sort using unchecked stored epoch numbers",
  );
  assert.match(
    depositsRouteSource,
    /const LOG_CHUNK_BLOCKS = 10_000n/,
    "deposits API log scans must stay within the Linea public RPC 10k block limit",
  );
  assert.match(
    depositsRouteSource,
    /bucket: "api-deposits"[\s\S]*if \(rateLimited\) return applyNoStoreHeaders\(rateLimited\)/,
    "deposits API rate-limit responses must remain no-store before cache lookup or recovery",
  );
  const epochsRouteSource = readFileSync("app/api/epochs/route.ts", "utf8");
  assert.doesNotMatch(
    epochsRouteSource,
    /getEpochEndTime/,
    "resolved-epoch chain fallback must not issue guaranteed-zero end-time RPC reads",
  );
}
